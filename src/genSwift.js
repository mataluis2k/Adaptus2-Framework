const fs = require("fs");
const path = require("path");

// Load API Configuration
const apiConfigPath = path.join(__dirname, "apiConfig.json");
const outputSwiftFile = path.join(__dirname, "GeneratedAPIClient.swift");

function loadApiConfig() {
    const config = fs.readFileSync(apiConfigPath, "utf-8");
    return JSON.parse(config);
}

function generateSwiftSDK(apiConfig) {
    const sdkHeader = `
import Foundation

// MARK: - APIClient
class APIClient {
    private let baseURL: String
    private let session: URLSession

    init(baseURL: String) {
        self.baseURL = baseURL
        self.session = URLSession.shared
    }

    enum APIError: Error {
        case invalidURL
        case requestFailed
        case invalidResponse
    }

    // MARK: - Core Request Method
    private func request(
        endpoint: String,
        method: String,
        queryParams: [String: String]? = nil,
        body: [String: Any]? = nil,
        completion: @escaping (Result<[String: Any], APIError>) -> Void
    ) {
        guard var urlComponents = URLComponents(string: baseURL + endpoint) else {
            completion(.failure(.invalidURL))
            return
        }

        // Add query parameters
        if let queryParams = queryParams {
            urlComponents.queryItems = queryParams.map { URLQueryItem(name: $0.key, value: $0.value) }
        }

        guard let url = urlComponents.url else {
            completion(.failure(.invalidURL))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        if let body = body {
            request.addValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body, options: [])
        }

        session.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(.requestFailed))
                print("Request Error:", error)
                return
            }

            guard let data = data else {
                completion(.failure(.invalidResponse))
                return
            }

            do {
                let json = try JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
                completion(.success(json ?? [:]))
            } catch {
                completion(.failure(.invalidResponse))
            }
        }.resume()
    }
`;

    const sdkMethods = apiConfig
        .map((endpoint) => {
            const { route, allowMethods, dbTable } = endpoint;

            const methodNameBase = route
                .replace("/api/", "")
                .replace(/\//g, "_")
                .replace(/[^a-zA-Z0-9_]/g, "")
                .toLowerCase();

            const methods = [];

            if (allowMethods.includes("GET")) {
                methods.push(`
    // GET: ${route}
    func get${capitalize(dbTable)}(queryParams: [String: String]? = nil, completion: @escaping (Result<[String: Any], APIError>) -> Void) {
        request(endpoint: "${route}", method: "GET", queryParams: queryParams, completion: completion)
    }`);
            }

            if (allowMethods.includes("POST")) {
                methods.push(`
    // POST: ${route}
    func create${capitalize(dbTable)}(body: [String: Any], completion: @escaping (Result<[String: Any], APIError>) -> Void) {
        request(endpoint: "${route}", method: "POST", body: body, completion: completion)
    }`);
            }

            return methods.join("\n");
        })
        .join("\n");

    const sdkFooter = `
}

// MARK: - Utility Functions
private func capitalize(_ str: String) -> String {
    return str.prefix(1).uppercased() + str.dropFirst()
}
`;

    return sdkHeader + sdkMethods + sdkFooter;
}

function writeSwiftFile(content) {
    fs.writeFileSync(outputSwiftFile, content, "utf-8");
    console.log(`Swift SDK successfully generated at: ${outputSwiftFile}`);
}

function main() {
    const apiConfig = loadApiConfig();
    const swiftSDK = generateSwiftSDK(apiConfig);
    writeSwiftFile(swiftSDK);
}

main();
