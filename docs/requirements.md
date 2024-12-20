


CREATE TABLE messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sender_id INT NOT NULL,
    recipient_id INT DEFAULT NULL,
    group_name VARCHAR(255) DEFAULT NULL,
    message TEXT NOT NULL,
    status ENUM('pending', 'delivered', 'read') DEFAULT 'pending',
    timestamp DATETIME NOT NULL
);

#hls streaming server requirements 
npm install express multer aws-sdk mime-types
npm install fluent-ffmpeg @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe

CREATE TABLE video_catalog (
    videoID VARCHAR(64) PRIMARY KEY,  -- Unique identifier for each video (can be a hash or UUID)
    name VARCHAR(255) NOT NULL,       -- Name of the video
    description TEXT,                 -- Description of the video
    source ENUM('S3', 'local') NOT NULL,  -- Video source (either 'S3' or 'local')
    filename VARCHAR(255) NOT NULL,   -- Filename or S3 key of the video
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- Record creation timestamp
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP  -- Record update timestamp
);

#push Notification packages
npm install express body-parser node-fetch web-push firebase-admin


CREATE TABLE device_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token TEXT NOT NULL,
    type ENUM('fcm', 'webpush') NOT NULL,
    UNIQUE KEY (user_id, type)
);

npx web-push generate-vapid-keys

### Implementation in server2.js server 

const PushNotification = require("./modules/pushNotification"); // Adjust path

const fcmConfig = require("./config/fcmConfig.json");
const vapidKeys = {
    subject: "mailto:your-email@example.com",
    publicKey: "your-public-key",
    privateKey: "your-private-key",
};

const dbConfig = {
    getConnection: async () => await getDbConnection({ dbType: "mysql", dbConnection: "MYSQL_1" }),
};

const pushNotification = new PushNotification(app, fcmConfig, vapidKeys, dbConfig);


## Mail module requirements 
npm install express nodemailer @sendgrid/mail mailchimp-transactional
CREATE TABLE email_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    provider ENUM('sendmail', 'sendgrid', 'mailchimp') NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body_text TEXT,
    body_html TEXT,
    status ENUM('pending', 'sent', 'failed') DEFAULT 'pending',
    error_message TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME DEFAULT NULL
);

To modify the **Mail Module** to **read email data from a database table** instead of receiving it via an endpoint, follow these steps:

---

### Updated Requirements:
1. Fetch email data (e.g., recipients, subject, body, provider) from a database table.
2. Process pending emails in batches and send them using the appropriate provider (`Sendmail`, `SendGrid`, or `Mailchimp`).
3. Update the database with the status of sent emails (e.g., `pending`, `sent`, `failed`).
4. Run the email processing logic at scheduled intervals or triggered manually.

---

### Updated **Mail Module**

```javascript
const nodemailer = require("nodemailer");
const sgMail = require("@sendgrid/mail");
const mailchimp = require("@mailchimp/mailchimp_transactional");

class MailModule {
    constructor(app, config, dbConfig) {
        this.app = app;
        this.config = config;

        // Configure Sendmail
        this.sendmailTransport = nodemailer.createTransport({
            sendmail: true,
            newline: "unix",
            path: "/usr/sbin/sendmail",
        });

        // Configure SendGrid
        if (config.sendgridApiKey) {
            sgMail.setApiKey(config.sendgridApiKey);
        }

        // Configure Mailchimp
        this.mailchimpClient = config.mailchimpApiKey
            ? mailchimp(config.mailchimpApiKey)
            : null;

        this.dbConfig = dbConfig;

        // Register manual processing route
        this.registerRoutes();
    }

    async getPendingEmails() {
        const query = `SELECT * FROM email_queue WHERE status = 'pending' ORDER BY created_at LIMIT 10`;

        const connection = await this.dbConfig.getConnection();
        const [rows] = await connection.execute(query);
        connection.release();
        return rows;
    }

    async updateEmailStatus(emailId, status, error = null) {
        const query = `UPDATE email_queue SET status = ?, error_message = ?, sent_at = NOW() WHERE id = ?`;

        const connection = await this.dbConfig.getConnection();
        await connection.execute(query, [status, error, emailId]);
        connection.release();
    }

    async sendEmail(provider, options) {
        switch (provider) {
            case "sendmail":
                return this.sendWithSendmail(options);
            case "sendgrid":
                return this.sendWithSendGrid(options);
            case "mailchimp":
                return this.sendWithMailchimp(options);
            default:
                throw new Error("Invalid email provider specified");
        }
    }

    async sendWithSendmail({ from, to, subject, text, html }) {
        const mailOptions = { from, to, subject, text, html };
        return this.sendmailTransport.sendMail(mailOptions);
    }

    async sendWithSendGrid({ from, to, subject, text, html }) {
        const msg = { from, to, subject, text, html };
        return sgMail.send(msg);
    }

    async sendWithMailchimp({ from, to, subject, text, html }) {
        if (!this.mailchimpClient) {
            throw new Error("Mailchimp API key is not configured");
        }

        const message = {
            from_email: from,
            subject,
            text,
            html,
            to: [{ email: to }],
        };

        return this.mailchimpClient.messages.send({ message });
    }

    async processEmails() {
        const emails = await this.getPendingEmails();

        for (const email of emails) {
            const { id, provider, from_email, to_email, subject, body_text, body_html } = email;

            try {
                // Send the email using the appropriate provider
                await this.sendEmail(provider, {
                    from: from_email,
                    to: to_email,
                    subject,
                    text: body_text,
                    html: body_html,
                });

                // Update the email status to "sent"
                await this.updateEmailStatus(id, "sent");
                console.log(`Email ID ${id} sent successfully`);
            } catch (error) {
                // Update the email status to "failed" with the error message
                await this.updateEmailStatus(id, "failed", error.message);
                console.error(`Failed to send email ID ${id}:`, error.message);
            }
        }
    }

    registerRoutes() {
        // Manually trigger email processing
        this.app.post("/mail/process", async (req, res) => {
            try {
                await this.processEmails();
                res.json({ message: "Email processing complete" });
            } catch (error) {
                console.error("Error processing emails:", error.message);
                res.status(500).json({ error: "Failed to process emails" });
            }
        });
    }
}

module.exports = MailModule;
```

---

### Database Table for Emails

Create a table to store email queue data:
```sql
CREATE TABLE email_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    provider ENUM('sendmail', 'sendgrid', 'mailchimp') NOT NULL,
    from_email VARCHAR(255) NOT NULL,
    to_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body_text TEXT,
    body_html TEXT,
    status ENUM('pending', 'sent', 'failed') DEFAULT 'pending',
    error_message TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME DEFAULT NULL
);
```

---

### Integration with `server2.js`

1. **Update Configuration**:
   Add environment variables for SendGrid and Mailchimp to your `.env` file:
   ```env
   SENDGRID_API_KEY=your-sendgrid-api-key
   MAILCHIMP_API_KEY=your-mailchimp-api-key
   ```

2. **Initialize the Mail Module**:
   Import and initialize the `MailModule` in `server2.js`:
   ```javascript
   const MailModule = require("./modules/mailModule"); // Adjust path

   const mailConfig = {
       sendgridApiKey: process.env.SENDGRID_API_KEY,
       mailchimpApiKey: process.env.MAILCHIMP_API_KEY,
   };

   const dbConfig = {
       getConnection: async () => await getDbConnection({ dbType: "mysql", dbConnection: "MYSQL_1" }),
   };

   const mailModule = new MailModule(app, mailConfig, dbConfig);
   ```

---

### Scheduling Email Processing

Use a **cron job** or a scheduler like `node-cron` to run the `processEmails` function periodically.

#### Install `node-cron`:
```bash
npm install node-cron
```

#### Add Scheduler:
In `server2.js`:
```javascript
const cron = require("node-cron");

// Schedule email processing every minute
cron.schedule("* * * * *", async () => {
    try {
        await mailModule.processEmails();
        console.log("Scheduled email processing completed.");
    } catch (error) {
        console.error("Error during scheduled email processing:", error.message);
    }
});
```

---

### API Endpoint

- **Manually Trigger Email Processing**:
   ```
   POST /mail/process
   ```

---

### Workflow:
1. Emails are added to the `email_queue` table with `status = 'pending'`.
2. The `processEmails` function retrieves pending emails, sends them via the specified provider, and updates their status in the database.
3. Email processing can be triggered manually or scheduled.


### Payment Module
npm install braintree
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    stripe_customer_id VARCHAR(255) UNIQUE
);

CREATE TABLE subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    stripe_subscription_id VARCHAR(255) UNIQUE NOT NULL,
    status ENUM('active', 'past_due', 'canceled') NOT NULL,
    plan_id VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    stripe_payment_intent_id VARCHAR(255) UNIQUE NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    status ENUM('succeeded', 'pending', 'failed') NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);


## Apple payment verification
npm install jsonwebtoken
npm install node-apple-receipt-verify

```
CREATE TABLE apple_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,         -- Unique identifier for the transaction record
    transaction_id VARCHAR(255) NOT NULL,     -- Unique transaction identifier from Apple
    product_id VARCHAR(255) NOT NULL,         -- ID of the purchased product
    user_id INT NOT NULL,                     -- User ID of the purchaser
    purchase_date DATETIME NOT NULL,          -- Date and time of purchase
    notification_type VARCHAR(50) NOT NULL,  -- Type of Apple notification (e.g., SUBSCRIBED, DID_RENEW)
    subtype VARCHAR(50),                      -- Subtype of the notification (e.g., INITIAL_BUY, VOLUNTARY)
    receipt TEXT NOT NULL,                    -- Base64-encoded receipt sent by Apple
    status ENUM('pending', 'processed', 'failed') DEFAULT 'pending', 
                                              -- Processing status of the transaction
    error_message TEXT,                       -- Error message if processing fails
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                              -- Record creation timestamp
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                                              -- Last update timestamp for the record
);
```
## Google payments schema
npm install googleapis

```
CREATE TABLE google_transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,         -- Unique identifier for the transaction record
    purchase_token VARCHAR(255) NOT NULL,     -- Unique purchase token from Google
    package_name VARCHAR(255) NOT NULL,       -- App's package name
    product_id VARCHAR(255) NOT NULL,         -- ID of the purchased product
    user_id INT NOT NULL,                     -- User ID of the purchaser
    notification_type VARCHAR(50) NOT NULL,  -- Type of notification (e.g., PURCHASE, CANCEL)
    purchase_state INT NOT NULL,              -- Purchase state from Google API (e.g., 0 for purchased)
    status ENUM('pending', 'processed', 'failed') DEFAULT 'pending', 
                                              -- Processing status of the transaction
    error_message TEXT,                       -- Error message if processing fails
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                              -- Record creation timestamp
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                                              -- Last update timestamp for the record
);
```
