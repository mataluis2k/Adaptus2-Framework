WITH mysql MYSQL_1 DO 
    IF GET testTemplate THEN
        # response ({ "key": "responseData" })
        update response = "Hello Im here!"
        mergeTemplate {"data":{"name": "John", "age": "30"},  "template":"Hello, my name is {{name}} and I am {{age}} years old."}
        # sendMailgunEmail { "to" : "mataluis2k@gmail.com" , "subject":"Test Email" , "text": "${data.response}" }
    IF GET testDB THEN        
        rawQuery data:{ "query":"select * from video_catalog"}
    IF GET testmail THEN        
        rawQuery data:{ "query":"select username, acl from users where id = 94"}
        mergeTemplate {"data":"${data.response}",  "template":"Hello, my name is {{username}} and I am {{acl}} years old."}
        # sendMailgunEmail { "to" : "mataluis2k@gmail.com" , "subject":"Test Email" , "text": "${data.response}" }
    
