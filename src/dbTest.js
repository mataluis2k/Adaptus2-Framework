const path = require('path');

const { getDbConnection, query } = require('./modules/db.js');

require('dotenv').config('./.env');


const dbType = process.env.STREAMING_DBTYPE || "mysql";
const dbConnection = process.env.DBSTREAMING_DBCONNECTION || "MYSQL_1";

const config = { 'dbType': 'mysql', 'dbConnection': 'MYSQL_1' } ;
const db = getDbConnection(config);
// If not in cache, query the database
const video = query(config,'SELECT * FROM video_catalog WHERE hls is null', []);
if (video.length > 0) {
    video.forEach(element => {
        console.log("Video: ",element);
        // call the function that will generate the hls
        //generateHls(element.videoID, element.videoPath);
    });
}
return null;