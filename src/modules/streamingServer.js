const express = require("express");
const AWS = require("aws-sdk");
const ffmpeg = require("fluent-ffmpeg");
const mime = require("mime-types");
const path = require("path");
const fs = require("fs");
const Redis = require("ioredis");
const consolelog = require('./logger');
const { query } = require("./db");
// Configure ffmpeg and ffprobe
ffmpeg.setFfmpegPath(require("@ffmpeg-installer/ffmpeg").path);
ffmpeg.setFfprobePath(require("@ffprobe-installer/ffprobe").path);
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const VIDEO_TABLE = process.env.VIDEO_TABLE || "video_catalog";
const VIDEO_ID_COLUMN = process.env.VIDEO_ID_COLUMN || "videoID";
const VIDEO_PATH_COLUMN = process.env.VIDEO_PATH_COLUMN || "videoPath";
const VIDEO_HLS_COLUMN = process.env.VIDEO_HLS_COLUMN || "hls";
const VIDEO_SOURCE_COLUMN = process.env.VIDEO_SOURCE_COLUMN || "source";
const VIDEO_FILENAME_COLUMN = process.env.VIDEO_FILENAME_COLUMN || "filename";
const VIDEO_PARAM_NAME = process.env.VIDEO_PARAM_NAME || "videoID";
const LOCAL_VIDEO_PATH = process.env.STREAMING_FILESYSTEM_PATH || "./videos";

// Redis client configuration
consolelog.log("hls_output: ",path.join(__dirname, "hls_output"));
const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');

console.log("configDir: ",configDir);
const ffmpegConfigPath = path.join(configDir, 'ffmpeg_profiles.json');
// filestat to check if the file exists
try {
    fs.statSync(ffmpegConfigPath);
} catch (err) {
    console.error(`Error reading ffmpeg profiles: ${err.message}`);
    return;
}
const ffmpegProfiles = JSON.parse(fs.readFileSync(ffmpegConfigPath, 'utf8'));
// Read desired profile from environment variable, default to "mediumBandwidth"
const selectedProfileName = process.env.FFMPEG_PROFILE || "mediumBandwidth";
const selectedProfile = ffmpegProfiles[selectedProfileName];

if (!selectedProfile) {
  console.warn(`Selected profile "${selectedProfileName}" not found. Using "mediumBandwidth" as default.`);
}

function profileToOutputOptions(profile) {
    const options = [];
    for (const key in profile) {
      if (profile.hasOwnProperty(key)) {
        options.push(`-${key}`, profile[key]);
      }
    }
    return options;
  }
  
const ffmpegOptions = profileToOutputOptions(selectedProfile || ffmpegProfiles["mediumBandwidth"]);





class StreamingServer {
    constructor(app, s3Config,redis) {
        this.app = app;
        this.s3 = new AWS.S3({
            accessKeyId: s3Config.accessKeyId,
            secretAccessKey: s3Config.secretAccessKey,
            region: s3Config.region,
        });
        this.redis = redis;
        // Use the shared uuidTools instance
        this.uuidTools = require('./dynamicUUID')(redis);
        this.getAsync = async (cacheKey) => {
            return await redis.get(cacheKey);
        };
        /* Set Async function  params: cacheKey, data, ttl */
        this.setAsync = async (cacheKey, data, ttl) => {
            return await redis.setex(cacheKey, ttl, JSON.stringify(data));
        };
    }

    async generateBulkHLS() {
        const dbType = process.env.STREAMING_DBTYPE || "mysql";
        const dbConnection = process.env.DBSTREAMING_DBCONNECTION || "MYSQL_1";
        const config = { dbType, dbConnection };            
        const videos = query(config, `SELECT * FROM ${VIDEO_TABLE} WHERE ${VIDEO_HLS_COLUMN} is null`, []);
        if (videos.length > 0) {
            videos.forEach(element => {
                consolelog.log("Video: ", element);
                // Fix: Pass the correct arguments (sourcePath first, then videoID)
                const req = { params: { [VIDEO_PARAM_NAME]: element[VIDEO_ID_COLUMN] } };
                const res = { json: (data) => console.log(data), status: (code) => ({ send: (msg) => console.log(code, msg) }) };
                this.generateHLS(req, res, element[VIDEO_PATH_COLUMN], element[VIDEO_ID_COLUMN]);
            });
        }
        return null;
    }

    async getVideoById(videoID) {
        // Attempt to get video details from cache first
        //Check if videoID is UUID and get the original ID
        const originalId = await this.uuidTools.getOriginalIdFromUUID(VIDEO_TABLE, VIDEO_ID_COLUMN, videoID);
        if (originalId) {
            videoID = originalId;
        }
        console.log("videoID: ",videoID);
        var video = await this.getAsync(videoID);
        if (video) {
            return JSON.parse(video);
        }
        
        const dbType = process.env.STREAMING_DBTYPE || "mysql";
        const dbConnection = process.env.DBSTREAMING_DBCONNECTION || "MYSQL_1";
        
        // If not in cache, query the database
        video = await query({ dbType, dbConnection },`SELECT * FROM ${VIDEO_TABLE} WHERE ${VIDEO_ID_COLUMN} = ?`, [videoID]);
        if (video.length > 0) {
            // Cache the video data for future requests
            //await setAsync(videoID, JSON.stringify(video[0]), 'EX', 3600); // Cache for 1 hour
            consolelog.log("Video: ",video[0]);
            return video[0];
        }
        return null;
    }

    sanitizeInput(input) {
        return input;
        // return input.replace(/[^a-zA-Z0-9-_\.]/g, '');
    }
      
      // Revised streamFromFileSystem with path resolution check
      streamFromFileSystem(req, res, filePath) {
          const safeFileName = this.sanitizeInput(path.basename(filePath));
          const fullPath = path.join(LOCAL_VIDEO_PATH, safeFileName);
          const resolvedPath = path.resolve(fullPath);
          if (!resolvedPath.startsWith(path.resolve(LOCAL_VIDEO_PATH))) {
              return res.status(400).send("Invalid file path");
          }
      
          fs.stat(resolvedPath, (err, stats) => {
              if (err) {
                  return res.status(404).send("File not found");
              }
              const range = req.headers.range;
              if (!range) {
                  return res.status(416).send("Requires Range header");
              }
              const CHUNK_SIZE = 10 ** 6; // 1MB
              const start = Number(range.replace(/\D/g, ""));
              const end = Math.min(start + CHUNK_SIZE, stats.size - 1);
              res.writeHead(206, {
                  "Content-Range": `bytes ${start}-${end}/${stats.size}`,
                  "Accept-Ranges": "bytes",
                  "Content-Length": end - start + 1,
                  "Content-Type": mime.lookup(resolvedPath) || "video/mp4",
              });
              const stream = fs.createReadStream(resolvedPath, { start, end });
              stream.pipe(res);
          });
    }

    async streamFromS3(req, res, bucket, key) {
        const params = {
            Bucket: bucket,
            Key: key,
        };

        try {
            const data = await this.s3.headObject(params).promise();
            const range = req.headers.range;

            if (!range) {
                return res.status(416).send("Requires Range header");
            }

            const CHUNK_SIZE = 10 ** 6; // 1MB
            const start = Number(range.replace(/\D/g, ""));
            const end = Math.min(start + CHUNK_SIZE, data.ContentLength - 1);

            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${data.ContentLength}`,
                "Accept-Ranges": "bytes",
                "Content-Length": end - start + 1,
                "Content-Type": mime.lookup(key) || "video/mp4",
            });

            const stream = this.s3
                .getObject({
                    ...params,
                    Range: `bytes=${start}-${end}`,
                })
                .createReadStream();

            stream.pipe(res);
        } catch (err) {
            console.error("Error streaming from S3:", err.message);
            res.status(500).send("Internal Server Error");
        }
    }

    async generateHLS(req, res, sourcePath, videoID) {
        // Sanitize sourcePath and videoID
        const safeSourcePath = path.resolve(this.sanitizeInput(sourcePath));
        const safeVideoID = this.sanitizeInput(videoID);
        const outputDir = path.join(__dirname, "hls_output", safeVideoID);
        const resolvedOutputDir = path.resolve(outputDir);
        if (!resolvedOutputDir.startsWith(path.resolve(__dirname, "hls_output"))) {
            return res.status(400).send("Invalid video identifier");
        }
        if (!fs.existsSync(resolvedOutputDir)) {
            fs.mkdirSync(resolvedOutputDir, { recursive: true });
        }
        const outputFile = path.join(resolvedOutputDir, "playlist.m3u8");
    
        const cacheKey = `hls:${safeVideoID}`;
        const cachedPlaylist = await this.getAsync(cacheKey);
        const link = `/hls/${safeVideoID}/playlist.m3u8`;
        if (cachedPlaylist) {
            return res.json({
                message: "HLS playlist served from cache",
                playlist: link,
            });
        }
        ffmpeg(safeSourcePath)
            .outputOptions(ffmpegOptions.concat([
                `-hls_segment_filename ${resolvedOutputDir}/segment_%03d.ts`
            ]))
            .output(outputFile)
            .on("end", async () => {
                consolelog.log("HLS conversion complete");
                await this.setAsync(cacheKey, link, 3600); // Cache for 1 hour
                res.json({
                    message: "HLS playlist generated",
                    playlist: link,
                });
            })
            .on("error", (err) => {
                console.error("Error during HLS generation:", err.message);
                res.status(500).send("Error generating HLS");
            })
            .run();
    }


    registerRoutes() {
        // Stream video by ID
    
        this.app.get(`/stream/:${VIDEO_PARAM_NAME}`, async (req, res) => {
            const videoID = req.params[VIDEO_PARAM_NAME];
            const video = await this.getVideoById(videoID);
            consolelog.log("video: ",video);
            if (!video) return res.status(404).send("Video not found");

            if (video[VIDEO_SOURCE_COLUMN] === "local") {
                const filePath = path.join(LOCAL_VIDEO_PATH, video[VIDEO_FILENAME_COLUMN]);
                consolelog.log("filePath: ",filePath);
                this.streamFromFileSystem(req, res, filePath);
            } else if (video[VIDEO_SOURCE_COLUMN] === "S3") {
                this.streamFromS3(req, res, S3_BUCKET_NAME, video[VIDEO_FILENAME_COLUMN]);
            } else {
                res.status(400).send("Invalid video source");
            }
        });

            // Generate or Retrieve HLS from video ID
        this.app.get(`/hls/generate/:${VIDEO_PARAM_NAME}`, async (req, res) => {
            const videoID = req.params[VIDEO_PARAM_NAME];

            try {
                const video = await this.getVideoById(videoID);

                if (!video) {
                    return res.status(404).send("Video not found");
                }

                // If the HLS field is not null, return the existing playlist
                if (video[VIDEO_HLS_COLUMN]) {
                    return res.json({
                        message: "HLS playlist",
                        playlist: video[VIDEO_HLS_COLUMN], // Assuming this contains the path to the playlist
                    });
                }

                // If the HLS field is null, generate the playlist
                if (video[VIDEO_SOURCE_COLUMN] === "local") {
                    const filePath = path.join(LOCAL_VIDEO_PATH, video[VIDEO_FILENAME_COLUMN]);

                    // Generate HLS and update the database with the new playlist path
                    this.generateHLS(req, res, filePath, videoID);
                } else {
                    res.status(400).send("HLS generation is only supported for local files");
                }
            } catch (err) {
                console.error("Error handling HLS generation:", err.message);
                res.status(500).send("Internal Server Error");
            }
        });

        
        // Serve HLS playlist and segments
        this.app.use("/hls", express.static(path.join(__dirname, "hls_output")));
    }
}

module.exports = StreamingServer;
