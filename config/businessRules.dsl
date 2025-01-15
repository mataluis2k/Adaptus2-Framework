WITH mysql MYSQL_1 DO
    IF GET video_catalog THEN
        update labels = ${data.name}