### **Comprehensive Business Rules Taxonomy for CRM (Customer Relationship Management)**

This taxonomy outlines a structured and detailed set of **business rules** that the `RuleEngine` can execute to support building dynamic, automated, and configurable **CRM applications**. These rules focus on managing leads, contacts, opportunities, sales pipelines, customer engagement, and reporting.

---

### **1. Lead Management Rules**

#### **Lead Qualification**
- **Auto-Qualify Leads Based on Score:**  
   ```text
   IF POST leads WHEN score >= 80 THEN 
   UPDATE status = "qualified"
   ```
   - **Purpose:** Automatically qualify leads with a score above a defined threshold.

- **Flag Low-Quality Leads:**  
   ```text
   IF POST leads WHEN score < 30 THEN 
   UPDATE status = "unqualified"
   NOTIFY "Lead marked as low-quality"
   ```
   - **Purpose:** Flag leads that do not meet minimum quality criteria.

---

#### **Lead Assignment**
- **Assign Leads to Sales Team Based on Region:**  
   ```text
   IF POST leads WHEN region = "North America" THEN 
   UPDATE owner = "sales_team_north"
   ```
   - **Purpose:** Assign leads to specific sales teams based on geographic regions.

- **Rotate Leads Among Sales Representatives:**  
   ```text
   IF POST leads THEN 
   UPDATE owner = action.lead_rotation()
   ```
   - **Purpose:** Distribute leads evenly among available sales reps.

---

#### **Lead Follow-up Rules**
- **Send Reminder for Overdue Follow-Ups:**  
   ```text
   IF GET leads WHEN last_contact_date < current_date - 7 THEN 
   NOTIFY "Follow-up overdue for lead: ${lead_name}"
   ```
   - **Purpose:** Remind sales reps to follow up with leads that haven’t been contacted in 7 days.

- **Flag Leads with No Activity for 30 Days:**  
   ```text
   IF GET leads WHEN last_activity_date < current_date - 30 THEN 
   UPDATE status = "inactive"
   NOTIFY "Lead marked as inactive"
   ```
   - **Purpose:** Identify and flag stagnant leads.

---

### **2. Contact Management Rules**

#### **Contact Validation**
- **Enforce Unique Email Addresses:**  
   ```text
   IF POST contacts WHEN email EXISTS THEN 
   NOTIFY "Email address already exists"
   DELETE contacts
   ```
   - **Purpose:** Prevent duplicate contacts based on email addresses.

- **Validate Phone Number Format:**  
   ```text
   IF POST contacts WHEN phone_number NOT MATCHES /\d{10}/ THEN 
   NOTIFY "Invalid phone number format"
   DELETE contacts
   ```
   - **Purpose:** Ensure valid phone numbers are submitted.

---

#### **Contact Enrichment**
- **Auto-Tag Contacts Based on Job Title:**  
   ```text
   IF POST contacts WHEN job_title CONTAINS "Manager" THEN 
   UPDATE tags = "key_decision_maker"
   ```
   - **Purpose:** Automatically tag contacts as decision-makers based on their job title.

- **Populate Missing Country from Phone Code:**  
   ```text
   IF POST contacts WHEN country IS NULL THEN 
   UPDATE country = action.resolve_country(phone_number)
   ```
   - **Purpose:** Populate the country field based on phone number prefix.

---

### **3. Opportunity Management Rules**

#### **Pipeline Management**
- **Move Opportunities to Next Stage Automatically:**  
   ```text
   IF UPDATE opportunities WHEN status = "proposal_sent" AND days_since_update > 5 THEN 
   UPDATE status = "negotiation"
   ```
   - **Purpose:** Advance opportunities to the next stage based on elapsed time.

- **Close Lost Opportunities After Inactivity:**  
   ```text
   IF UPDATE opportunities WHEN last_contact_date < current_date - 60 THEN 
   UPDATE status = "closed_lost"
   NOTIFY "Opportunity closed due to inactivity"
   ```
   - **Purpose:** Mark inactive opportunities as "closed lost" after 60 days.

---

#### **Revenue Tracking**
- **Auto-Calculate Deal Value with Discounts:**  
   ```text
   IF POST opportunities WHEN discount > 0 THEN 
   UPDATE deal_value = (original_value - (original_value * (discount / 100)))
   ```
   - **Purpose:** Dynamically calculate deal value after applying discounts.

- **Flag High-Value Deals:**  
   ```text
   IF POST opportunities WHEN deal_value > 10000 THEN 
   UPDATE priority = "high"
   NOTIFY "High-value deal created: ${deal_name}"
   ```
   - **Purpose:** Prioritize high-value deals for focused attention.

---

### **4. Activity and Task Management Rules**

#### **Task Automation**
- **Create Follow-Up Task After Call:**  
   ```text
   IF POST activities WHEN type = "call" THEN 
   CREATE task WITH {"name": "Follow-up call", "due_date": current_date + 3, "owner": owner}
   ```
   - **Purpose:** Automatically create a follow-up task after logging a call.

- **Assign Task for Overdue Opportunities:**  
   ```text
   IF GET opportunities WHEN days_since_update > 10 THEN 
   CREATE task WITH {"name": "Revisit opportunity", "due_date": current_date + 1, "owner": owner}
   ```
   - **Purpose:** Generate tasks for overdue opportunities to prompt action.

---

### **5. Customer Engagement Rules**

#### **Customer Segmentation**
- **Identify VIP Customers:**  
   ```text
   IF GET customers WHEN total_spent > 5000 THEN 
   UPDATE customer_segment = "VIP"
   NOTIFY "Customer marked as VIP: ${customer_name}"
   ```
   - **Purpose:** Segment high-spending customers as VIPs.

- **Flag Inactive Customers:**  
   ```text
   IF GET customers WHEN last_purchase_date < current_date - 180 THEN 
   UPDATE customer_segment = "inactive"
   ```
   - **Purpose:** Mark customers as inactive if they haven't purchased in 6 months.

---

#### **Email and Notification Rules**
- **Send Welcome Email to New Contacts:**  
   ```text
   IF NEW contacts THEN 
   SEND contact to action.welcome_email
   ```
   - **Purpose:** Send a welcome email when a new contact is added.

- **Notify Sales Rep on New Opportunity:**  
   ```text
   IF NEW opportunities THEN 
   NOTIFY "New opportunity created: ${deal_name} assigned to ${owner}"
   ```
   - **Purpose:** Alert sales reps when a new opportunity is assigned to them.

- **Email Follow-Up for Expired Quotes:**  
   ```text
   IF UPDATE opportunities WHEN status = "quote_expired" THEN 
   SEND opportunity to action.follow_up_email
   ```
   - **Purpose:** Trigger a follow-up email when a quote expires.

---

### **6. Reporting and Analytics Rules**

#### **Performance Tracking**
- **Track Sales Rep Performance:**  
   ```text
   IF GET opportunities WHEN status = "closed_won" THEN 
   UPDATE sales_rep_wins = sales_rep_wins + 1
   ```
   - **Purpose:** Increment the win count for sales reps when opportunities are closed.

- **Flag Underperforming Sales Reps:**  
   ```text
   IF GET sales_reps WHEN closed_deals < 5 AND current_month THEN 
   NOTIFY "Sales rep underperforming: ${sales_rep_name}"
   ```
   - **Purpose:** Identify and flag underperforming sales representatives.

#### **Pipeline Health**
- **Identify Stagnant Opportunities:**  
   ```text
   IF GET opportunities WHEN days_in_stage > 30 THEN 
   UPDATE status = "stagnant"
   NOTIFY "Opportunity flagged as stagnant: ${opportunity_name}"
   ```
   - **Purpose:** Highlight opportunities stuck in a stage for too long.

- **Generate Weekly Pipeline Report:**  
   ```text
   IF WEEKLY THEN 
   INVOKE generatePipelineReport()
   ```
   - **Purpose:** Automate generation of pipeline reports weekly.

---

### **7. Integration Rules**

#### **External System Integration**
- **Push Closed Deals to ERP System:**  
   ```text
   IF UPDATE opportunities WHEN status = "closed_won" THEN 
   SEND opportunity to action.erp_integration
   ```
   - **Purpose:** Integrate closed deals into the ERP system for revenue tracking.

- **Sync Contacts with Marketing Automation Tools:**  
   ```text
   IF NEW contacts THEN 
   SEND contact to action.marketing_sync
   ```
   - **Purpose:** Synchronize new contacts with marketing platforms for campaigns.

---

### **Summary**

The **CRM business rules taxonomy** is organized into key functional segments:
1. **Lead Management**: Qualification, assignment, and follow-ups.
2. **Contact Management**: Validation, enrichment, and unique checks.
3. **Opportunity Management**: Pipeline automation, deal prioritization, and revenue tracking.
4. **Activity and Task Management**: Follow-up task automation.
5. **Customer Engagement**: Segmentation, notifications, and emails.
6. **Reporting and Analytics**: Performance tracking, pipeline health, and reports.
7. **Integration Rules**: Synchronization with ERP, marketing tools, and external systems.
