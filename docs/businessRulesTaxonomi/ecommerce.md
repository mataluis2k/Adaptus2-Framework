### **Comprehensive Business Rules Taxonomy for E-commerce**

This taxonomy defines a categorized and structured set of **business rules** that the `RuleEngine` can execute to build robust, dynamic, and configurable **e-commerce applications**. These rules are grouped by functionality to address various domains like order management, pricing, promotions, inventory control, and customer engagement.

---

### **1. Product Management Rules**

#### **Product Catalog**
- **Dynamic Discounts (Virtual Columns):**  
   ```text
   IF GET products WHEN price > 100 THEN 
   UPDATE discount = price * 0.1
   ```
   - **Purpose:** Apply dynamic discounts for high-value products.

- **Out-of-Stock Marking:**  
   ```text
   IF GET products WHEN stock_quantity = 0 THEN 
   UPDATE status = "out_of_stock"
   ```
   - **Purpose:** Mark products as out of stock dynamically.

- **Product Visibility Control:**  
   ```text
   IF GET products WHEN is_active = false THEN 
   DELETE product
   ```
   - **Purpose:** Hide inactive products from the catalog.

#### **Product Recommendations**
- **Upsell Products Based on Category:**  
   ```text
   IF GET products WHEN category_id = 1 THEN 
   SEND product to action.upsell_recommendations
   ```
   - **Purpose:** Generate product upsell recommendations.

- **Cross-sell Rules:**  
   ```text
   IF GET cart WHEN total_items > 2 THEN 
   SEND cart to action.cross_sell_products
   ```
   - **Purpose:** Suggest related products when cart has multiple items.

---

### **2. Pricing and Promotions Rules**

#### **Discount and Offer Rules**
- **Apply Discount for Price Thresholds:**  
   ```text
   IF GET products WHEN price > 200 THEN 
   UPDATE discount = price * 0.15
   ```
   - **Purpose:** Apply a 15% discount for premium products.

- **Seasonal Promotions:**  
   ```text
   IF GET products WHEN season = "winter" THEN 
   UPDATE discount = 20
   ```
   - **Purpose:** Apply flat seasonal discounts to products.

- **Coupon-based Discounts:**  
   ```text
   IF POST orders WHEN coupon_code = "SAVE10" THEN 
   UPDATE total_price = total_price - (total_price * 0.1)
   ```
   - **Purpose:** Reduce order price by 10% when a valid coupon is used.

#### **Tiered Pricing**
- **Dynamic Pricing Based on Quantity:**  
   ```text
   IF POST orders WHEN quantity >= 10 THEN 
   UPDATE unit_price = unit_price * 0.9
   ```
   - **Purpose:** Offer bulk pricing discounts for large quantities.

---

### **3. Order Management Rules**

#### **Order Validations**
- **Validate Minimum Order Value:**  
   ```text
   IF POST orders WHEN total_price < 20 THEN 
   NOTIFY "Minimum order value is $20"
   ```
   - **Purpose:** Ensure orders meet the minimum value criteria.

- **Prevent Orders for Out-of-Stock Products:**  
   ```text
   IF POST orders WHEN stock_quantity = 0 THEN 
   DELETE order
   NOTIFY "Product is out of stock"
   ```
   - **Purpose:** Prevent order submission when product is unavailable.

#### **Order Status Updates**
- **Automatically Mark Paid Orders for Fulfillment:**  
   ```text
   IF UPDATE orders WHEN payment_status = "paid" THEN 
   UPDATE status = "processing"
   SEND order to action.fulfillment_queue
   ```
   - **Purpose:** Move paid orders to the fulfillment process.

- **Cancel Unpaid Orders After Timeout:**  
   ```text
   IF UPDATE orders WHEN payment_status = "unpaid" AND order_age > 24 THEN 
   UPDATE status = "canceled"
   NOTIFY "Order canceled due to non-payment"
   ```
   - **Purpose:** Automatically cancel unpaid orders after 24 hours.

---

### **4. Inventory Management Rules**

#### **Stock Level Updates**
- **Deduct Stock for New Orders:**  
   ```text
   IF POST orders WHEN product_id IS NOT NULL THEN 
   UPDATE stock_quantity = stock_quantity - quantity
   ```
   - **Purpose:** Deduct stock when an order is placed.

- **Restock Products on Order Cancellation:**  
   ```text
   IF UPDATE orders WHEN status = "canceled" THEN 
   UPDATE stock_quantity = stock_quantity + quantity
   ```
   - **Purpose:** Revert stock levels when an order is canceled.

#### **Low Stock Alerts**
- **Notify Low Stock Threshold:**  
   ```text
   IF UPDATE products WHEN stock_quantity < 5 THEN 
   NOTIFY "Low stock for product: ${product_name}"
   ```
   - **Purpose:** Trigger low stock alerts for inventory managers.

---

### **5. Customer Management Rules**

#### **Customer Segmentation**
- **Identify High-Value Customers:**  
   ```text
   IF GET customers WHEN total_spent > 1000 THEN 
   UPDATE customer_segment = "VIP"
   ```
   - **Purpose:** Segment customers based on their total spending.

- **Flag Inactive Customers:**  
   ```text
   IF GET customers WHEN last_purchase_date IS NULL THEN 
   UPDATE customer_segment = "inactive"
   ```
   - **Purpose:** Categorize inactive customers.

#### **Customer Notifications**
- **Send Welcome Email for New Customers:**  
   ```text
   IF NEW customers THEN 
   SEND customer to action.welcome_email
   ```
   - **Purpose:** Automate welcome email for new customer sign-ups.

- **Notify on High-Value Orders:**  
   ```text
   IF POST orders WHEN total_price > 500 THEN 
   NOTIFY "New high-value order placed: ${order_id}"
   ```
   - **Purpose:** Alert admins for high-value orders.

---

### **6. Cart Management Rules**

#### **Abandoned Cart Handling**
- **Trigger Cart Abandonment Notification:**  
   ```text
   IF GET carts WHEN cart_age > 2 THEN 
   SEND cart to action.abandoned_cart_reminder
   ```
   - **Purpose:** Notify users about abandoned carts after 2 hours.

#### **Free Shipping Eligibility**
- **Apply Free Shipping for Orders Above a Threshold:**  
   ```text
   IF POST orders WHEN total_price > 50 THEN 
   UPDATE shipping_fee = 0
   ```
   - **Purpose:** Offer free shipping for qualifying orders.

#### **Cart Value Promotions**
- **Offer Discount for Specific Cart Values:**  
   ```text
   IF POST orders WHEN total_price BETWEEN 100 AND 200 THEN 
   UPDATE discount = 15
   ```
   - **Purpose:** Apply a $15 discount for orders within a specific range.

---

### **7. Payment and Refund Rules**

#### **Payment Handling**
- **Apply Surcharges for Specific Payment Methods:**  
   ```text
   IF POST orders WHEN payment_method = "credit_card" THEN 
   UPDATE total_price = total_price * 1.02
   ```
   - **Purpose:** Add a 2% surcharge for credit card payments.

- **Validate Payment Amount:**  
   ```text
   IF POST payments WHEN amount != order.total_price THEN 
   NOTIFY "Payment amount does not match order total"
   ```
   - **Purpose:** Prevent underpayment or overpayment.

#### **Refund Processing**
- **Auto-Approve Refund for Small Orders:**  
   ```text
   IF UPDATE refunds WHEN order.total_price < 50 THEN 
   UPDATE status = "approved"
   ```
   - **Purpose:** Automatically approve refunds for small orders.

---

### **8. Shipping and Delivery Rules**

#### **Shipping Eligibility**
- **Restrict Shipping to Certain Regions:**  
   ```text
   IF POST orders WHEN shipping_region = "restricted" THEN 
   NOTIFY "Shipping unavailable to selected region"
   DELETE order
   ```

- **Prioritize Fast Shipping for Premium Customers:**  
   ```text
   IF POST orders WHEN customer_segment = "VIP" THEN 
   UPDATE shipping_type = "express"
   ```

#### **Delivery Updates**
- **Notify Customers on Order Delivery:**  
   ```text
   IF UPDATE orders WHEN status = "delivered" THEN 
   SEND order to action.delivery_notification
   ```

---
