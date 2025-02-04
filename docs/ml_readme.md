# **Analytics Framework Module - README**

## **Overview**
The **Analytics Framework Module** is a component designed to add machine learning capabilities to your API server. This module enables **sentiment analysis**, **recommendation systems**, **anomaly detection**, and **explainability** for configured database tables. It supports dynamic training and prediction through user-defined configuration.

---

## **Features**

1. **Sentiment Analysis**:
   - Analyzes text fields to determine sentiment scores.
   - **Example Use Case**: Sentiment of customer reviews.
   - **Key**: `sentiment`

2. **Recommendation Systems**:
   - Groups similar items using clustering.
   - **Example Use Case**: Product or content recommendations.
   - **Key**: `recommendation`

3. **Anomaly Detection**:
   - Detects unusual patterns in numeric data.
   - **Example Use Case**: Fraud detection or outlier identification.
   - **Key**: `anomaly`

4. **Explainability**:
   - Provides reasoning for predictions.
   - **Example Use Case**: Why a user belongs to a specific cluster.
   - **Key**: `explainability`

5. **Dynamic Endpoint Exposure**:
   - Each ML model is exposed via its own API endpoint for querying predictions.
   - **Key**: Automatically enabled for all specified models.

6. **Periodic Training**:
   - Models are retrained periodically via a scheduled cron job.
   - **Key**: Automatically enabled for all specified models.


---

## **Configuration**

### **1. ML Configuration**

The ML module uses two configuration files:

1. **apiConfig.json**: Define which tables get ML capabilities
```json
[
    {
        "dbType": "mysql",
        "dbConnection": "MYSQL_1",
        "dbTable": "articles",
        "route": "/api/articles",
        "allowRead": ["id", "title", "content", "image_url", "author_id"],
        "allowWrite": ["title", "content", "image_url"],
        "keys": ["id"],
        "mlmodel": ["sentiment", "recommendation", "anomaly", "explainability"],
        "columnDefinitions": {
            "id": "INT PRIMARY KEY AUTO_INCREMENT",
            "title": "VARCHAR(255)",
            "content": "TEXT",
            "image_url": "VARCHAR(255)",
            "author_id": "INT"
        }
    }
]
```

2. **mlConfig.json**: Configure ML model behavior
```json
{
    "default": {
        "batchSize": 1000,
        "samplingRate": 1,
        "parallelProcessing": false,
        "incrementalTraining": false
    },
    "endpoints": {
        "articles": {
            "sentimentConfig": {
                "language": "English",
                "textPreprocessing": true,
                "minTextLength": 3,
                "combineFields": false
            },
            "recommendationConfig": {
                "k": 3,
                "scalingRange": [0, 1],
                "minClusterSize": 2,
                "missingValueStrategy": "mean",
                "weightedFields": {
                    "rating": 2,
                    "views": 1.5
                },
                "similarityThreshold": 0.5
            },
            "anomalyConfig": {
                "eps": 0.5,
                "minPts": 2,
                "scalingRange": [0, 1]
            }
        }
    }
}
```

Key Features:
* Automatic data type detection and preprocessing
* Support for mixed data types (numeric, categorical, text)
* Configurable parameters per model type
* Robust error handling and validation

## **Usage**

### **2. API Endpoints**
Once configured, the module automatically creates ML endpoints with enhanced capabilities:

#### **Sentiment Analysis**
```bash
GET /api/articles/sentiment
```
Response:
```json
{
    "data": {
        "data": [
            {
                "id": 1,
                "sentiment": 0.8,
                "confidence": 0.75,
                "wordCount": 120
            },
            {
                "id": 2,
                "sentiment": -0.2,
                "confidence": 0.65,
                "wordCount": 85
            }
        ],
        "stats": {
            "total": 2,
            "valid": 2,
            "avgSentiment": 0.3,
            "distribution": {
                "positive": 1,
                "neutral": 0,
                "negative": 1
            }
        },
        "config": {
            "language": "English",
            "textFields": ["content"],
            "textPreprocessing": true,
            "minTextLength": 3,
            "combineFields": false
        }
    }
}
```

#### **Recommendations**
```bash
GET /api/articles/recommendation
```
Response:
```json
{
    "data": {
        "clusters": [
            {
                "id": 0,
                "points": [1, 2],
                "centroid": [0.5, 0.8],
                "size": 2,
                "similarities": [0.95, 0.88]
            }
        ],
        "fieldProcessors": [
            ["price", {"type": "numeric", "params": {"min": 0, "max": 100}}],
            ["category", {"type": "categorical", "params": ["electronics", "books"]}]
        ],
        "stats": {
            "totalPoints": 100,
            "dimensions": 5,
            "clusterSizes": [45, 55],
            "averageSimilarity": 0.85
        }
    }
}
```

#### **Anomaly Detection**
```bash
GET /api/articles/anomaly
```
Response:
```json
{
    "data": {
        "clusters": [[1, 3], [2, 4]],
        "fieldProcessors": [
            ["price", {"type": "numeric", "params": {"min": 0, "max": 1000}}],
            ["category", {"type": "categorical", "params": ["normal", "suspicious"]}]
        ],
        "anomalies": [
            {
                "index": 5,
                "originalData": {
                    "id": 5,
                    "price": 999,
                    "category": "suspicious"
                }
            }
        ],
        "params": {
            "eps": 0.5,
            "minPts": 2,
            "scalingRange": [0, 1]
        }
    }
}
```

#### **Explainability**
```bash
GET /api/articles/explainability
```
Response:
```json
{
    "data": {
        "explainability": "Example Explainability Data"
    }
}
```

---

## **Periodic Training**
The models are retrained daily at midnight:
```bash
0 0 * * *
```
To change the schedule, update the `scheduleTraining` method in `analytics_framework.js`:
```javascript
schedule.scheduleJob('0 6 * * *', () => {
    console.log('Training models at 6 AM...');
    analytics.trainModels();
});
```

## **Best Practices**
1. Keep training configurations minimal to avoid overloading the system.
2. Use Redis for caching predictions where possible.
3. Periodically review model performance and retrain as needed.

---

### README: Configuring the ML Module

This guide provides step-by-step instructions on configuring the ML module using a definition file to control training behaviors. The configuration file is JSON-based and allows you to set both default behaviors and endpoint-specific overrides.

---

### File Structure

Your configuration file should follow this structure:

```json
{
    "default": {
        "batchSize": 1000,
        "samplingRate": 1,
        "parallelProcessing": false,
        "incrementalTraining": false
    },
    "endpoints": {
        "products": {
            "batchSize": 2000,
            "incrementalTraining": true
        }
    }
}
```

---

### Configuration Fields

#### **Global Settings (`default` Section)**
Specifies global defaults applied to all endpoints unless overridden:

| Field               | Type    | Description                                                                                 | Default Value |
|---------------------|---------|---------------------------------------------------------------------------------------------|---------------|
| `batchSize`         | Integer | Number of rows processed in each batch during training                                       | `1000`        |
| `samplingRate`      | Float   | Fraction of rows to sample for training (`1` = all rows, `0.1` = 10% of rows)               | `1`           |
| `parallelProcessing`| Boolean | Whether to train models for each endpoint in parallel                                        | `false`       |
| `incrementalTraining`| Boolean| Whether to update existing models incrementally instead of retraining from scratch           | `false`       |

#### **Sentiment Analysis Configuration**
Configure sentiment analysis behavior per endpoint:

| Field              | Type    | Description                                                                                  | Default Value |
|--------------------|---------|----------------------------------------------------------------------------------------------|---------------|
| `language`         | String  | Language for sentiment analysis (e.g., "English")                                            | `"English"`   |
| `textPreprocessing`| Boolean | Whether to apply text preprocessing (lowercase, punctuation removal, etc.)                    | `true`        |
| `minTextLength`    | Integer | Minimum text length to analyze                                                               | `3`           |
| `combineFields`    | Boolean | Whether to combine all text fields for analysis                                              | `false`       |

#### **Recommendation Configuration**
Configure recommendation system behavior:

| Field                | Type    | Description                                                                                | Default Value |
|---------------------|----------|--------------------------------------------------------------------------------------------|---------------|
| `k`                 | Integer  | Number of clusters for k-means                                                             | `3`           |
| `scalingRange`      | Array   | Range for scaling numeric values `[min, max]`                                              | `[0, 1]`      |
| `minClusterSize`    | Integer | Minimum number of points required for a valid cluster                                      | `2`           |
| `missingValueStrategy`| String | Strategy for handling missing values ("mean", "median", "mode", "zero", "remove")         | `"mean"`      |
| `weightedFields`    | Object  | Field weights for importance in clustering                                                 | `{}`          |
| `similarityThreshold`| Float   | Minimum similarity score for recommendations                                               | `0.5`         |

#### **Anomaly Detection Configuration**
Configure anomaly detection behavior:

| Field          | Type    | Description                                                                                     | Default Value |
|----------------|---------|--------------------------------------------------------------------------------------------------|---------------|
| `eps`          | Float   | Maximum distance between points in a cluster (DBSCAN parameter)                                  | `0.5`         |
| `minPts`       | Integer | Minimum points required to form a cluster (DBSCAN parameter)                                     | `2`           |
| `scalingRange` | Array   | Range for scaling numeric values `[min, max]`                                                    | `[0, 1]`      |

#### **`endpoints` Section**
Overrides the default settings for specific endpoints. Each key in this section corresponds to a `dbTable` in your API configuration.

| Field               | Type    | Description                                                                                 | Default Value |
|---------------------|---------|---------------------------------------------------------------------------------------------|---------------|
| `batchSize`         | Integer | Overrides the default batch size for this endpoint.                                          | Inherits from `default` |
| `samplingRate`      | Float   | Overrides the default sampling rate for this endpoint.                                       | Inherits from `default` |
| `parallelProcessing`| Boolean | Overrides the default parallel processing behavior for this endpoint.                        | Inherits from `default` |
| `incrementalTraining`| Boolean| Overrides the default incremental training behavior for this endpoint.                       | Inherits from `default` |

---

### Example Configuration

#### Global Defaults
```json
"default": {
    "batchSize": 1000,
    "samplingRate": 0.5,
    "parallelProcessing": true,
    "incrementalTraining": false
}
```
- **Explanation:**
  - By default, each training process will use 50% of the dataset (`samplingRate: 0.5`).
  - Models are trained in parallel across endpoints (`parallelProcessing: true`).
  - Batch size is 1000 rows per batch.
  - Models are retrained from scratch (`incrementalTraining: false`).

#### Endpoint-Specific Configuration
```json
"endpoints": {
    "products": {
        "batchSize": 2000,
        "incrementalTraining": true
    }
}
```
- **Explanation:**
  - For the `products` table:
    - Uses a batch size of 2000 rows.
    - Updates models incrementally instead of retraining them completely (`incrementalTraining: true`).
    - Inherits `samplingRate: 0.5` and `parallelProcessing: true` from the `default` configuration.

---

### Applying the Configuration

1. **Create the Configuration File**
   Save the JSON configuration in a file, e.g., `mlConfig.json`.

2. **Set File Path in the ML Module**
   Ensure the file path is correctly referenced when initializing the ML module:
   ```javascript
   const mlAnalytics = new MLAnalytics('./config/apiConfig.json', './config/mlConfig.json');
   ```

3. **Load Configuration**
   The module automatically loads the configuration and applies the logic during training:
   ```javascript
   mlAnalytics.loadConfig();
   mlAnalytics.trainModels();
   ```

4. **Verify Logs**
   Check logs to ensure the configuration is being applied:
   - Global settings are applied unless an endpoint-specific configuration overrides them.
   - Warnings are logged if an endpoint is missing from the configuration.

---

### Advanced Tips

#### Validate Your Configuration
Run a JSON linter to ensure your configuration file is valid:
```bash
jsonlint mlConfig.json
```

#### Debugging
If training behaves unexpectedly:
- Verify that the endpoint exists in the `apiConfig.json`.
- Check the logs for messages about missing or invalid configurations.

#### Combining Sampling and Batching
If you use both `samplingRate` and `batchSize`, sampling reduces the dataset before batching. Ensure the sampled dataset size is large enough to accommodate meaningful batches.

---

### Example Output

For the above configuration:
```plaintext
Main configuration loaded successfully.
ML configuration loaded successfully.
Training models for products in batches of 2000...
Processing batch of 2000 rows for products...
Training recommendation model for products incrementally...
Recommendation model trained for products.
```
