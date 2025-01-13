# Test syntax
With mysql MYSQL_1 DO
IF GET articles WHEN title = "How to Start Coding" THEN 
     update title = "How to Start Coding PHP"

# Calculate discount and tax for GET requests
IF GET products WHEN price > 20 THEN 
     update price = price - (price * 0.1)
     update tax = price * 0.07

# Calculate discount and tax for POST requests
IF POST products THEN 
     update tax = price * 0.07
     update discount = IF price > 20 THEN price * 0.1

IF POST register THEN 
     update password = sha256("${data.password}")
     create_record entity:users data:{ "username": "${data.username}", "password": "${data.password}", "acl": "${data.country}" } 


     
         
IF GET videos THEN
     update url = http://localhost:3000/stream/${data.videoID}
     update id = ${data.videoID}
     update labels = ${data.name}
     update hero = http://localhost:3000/img/${data.hero}
