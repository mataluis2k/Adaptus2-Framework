Workflow welcomeCustomer
WITH mysql MYSQL_1 DO 
        # response ({ "key": "responseData" })
        update response = "Hello Im here!"
        mergeTemplate {"data":{"name": "John", "age": "30"},  "template":"Hello, my name is {{name}} and I am {{age}} years old."}
        # sendMailgunEmail { "to" : "mataluis2k@gmail.com" , "subject":"Test Email" , "text": "${data.response}" }
Workflow smoothData
WITH mysql MYSQL_1 DO
        rawQuery data:{ "query":"select * from video_catalog"}
Workflow ExitCustomer
WITH mysql MYSQL_1 DO              
        rawQuery data:{ "query":"select username, acl from users where id = 94"}
        mergeTemplate {"data":"${data.response}",  "template":"Hello, my name is {{username}} and I am {{acl}} years old."}
        # sendMailgunEmail { "to" : "mataluis2k@gmail.com" , "subject":"Test Email" , "text": "${data.response}" }