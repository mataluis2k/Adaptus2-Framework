class EmailService {
    static async queueWelcomeEmail(email) {
        // Simulate email queuing
        console.log(`Queuing email for: ${email}`);
        return `email_queued_for_${email}`;
    }
}

module.exports = EmailService;
