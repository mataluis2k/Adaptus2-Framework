With mysql MYSQL_1 DO
     IF GET articles THEN
          update labels = ${data.category}
          update updatedBy = ${data.author}
     IF POST makedata THEN
          create_record entity:test_table data:{"testdata": "${data.testdata}"}
     IF POST register THEN      
          create_record entity:users data:{ "username": "${data.username}", "password": "${data.password}", "acl": "${data.country}" } 