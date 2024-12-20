
# Test syntax

IF GET articles WHEN title = "How to Start Coding" THEN 
update title = "How to Start Coding PHP"

# Calculate discount and tax for GET requests
IF GET products WHEN price > 20 THEN 
     price = price - (price * 0.1)

# Calculate discount and tax for POST requests
IF POST products THEN 
update tax = price * 0.07
update discount = IF price > 20 THEN price * 0.1
IF POST orders WHEN payment != 'complete' THEN
     send order to payments
