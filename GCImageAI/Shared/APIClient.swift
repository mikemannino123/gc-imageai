import Foundation
import UIKit

// MARK: - Base URL

#if DEBUG
let baseURL = "http://localhost:3000"
#else
let baseURL = "https://api.gcimageai.com"   // replace with prod Railway URL
#endif

// MARK: - APIClient

final class APIClient {
    static let shared = APIClient()
    private init() {}

    private let session = URLSession.shared

    // MARK: - Apple Sign-In

    func appleSignIn(identityToken: String, fullName: String?, email: String?) async throws -> AuthResponse {
        var body: [String: Any] = ["identityToken": identityToken]
        if let name = fullName { body["fullName"] = name }
        if let e = email { body["email"] = e }

        return try await post("/auth/apple", body: body, auth: false)
    }

    // MARK: - Me

    func getMe() async throws -> MeResponse {
        return try await get("/users/me")
    }

    // MARK: - Generate (text-to-image)

    func generate(prompt: String) async throws -> GenerationResponse {
        let body: [String: Any] = ["prompt": prompt]
        return try await post("/generate", body: body)
    }

    // MARK: - Generate (image-to-image)

    func generate(prompt: String, image: UIImage) async throws -> GenerationResponse {
        guard let jwt = Keychain.jwt else { throw AppError.notAuthenticated }

        let boundary = UUID().uuidString
        var request = URLRequest(url: URL(string: baseURL + "/generate")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        // prompt field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"prompt\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(prompt)\r\n".data(using: .utf8)!)
        // image field
        if let imageData = image.jpegData(compressionQuality: 0.85) {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"image\"; filename=\"reference.jpg\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
            body.append(imageData)
            body.append("\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let (data, response) = try await session.data(for: request)
        try validateStatus(response, data: data)
        return try JSONDecoder().decode(GenerationResponse.self, from: data)
    }

    // MARK: - Sync subscription

    func syncSubscription() async throws {
        let _: EmptyResponse = try await post("/subscriptions/revenuecat/sync", body: [:])
    }

    // MARK: - Generation history

    func history(page: Int = 1, limit: Int = 20) async throws -> [GenerationRecord] {
        struct HistoryResponse: Decodable {
            let generations: [GenerationRecord]
        }
        let result: HistoryResponse = try await get("/users/me/history?page=\(page)&limit=\(limit)")
        return result.generations
    }

    // MARK: - Helpers

    private func get<T: Decodable>(_ path: String) async throws -> T {
        guard let jwt = Keychain.jwt else { throw AppError.notAuthenticated }
        var request = URLRequest(url: URL(string: baseURL + path)!)
        request.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        try validateStatus(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func post<T: Decodable>(_ path: String, body: [String: Any], auth: Bool = true) async throws -> T {
        var request = URLRequest(url: URL(string: baseURL + path)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if auth, let jwt = Keychain.jwt {
            request.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        try validateStatus(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func validateStatus(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            if let apiError = try? JSONDecoder().decode(APIError.self, from: data) {
                throw apiError
            }
            throw AppError.serverError(http.statusCode)
        }
    }
}

// MARK: - Errors

enum AppError: LocalizedError {
    case notAuthenticated
    case serverError(Int)
    case insufficientCredits
    case tierRequired(UserTier)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:       return "Please sign in to continue."
        case .serverError(let code): return "Server error (\(code)). Please try again."
        case .insufficientCredits:   return "Not enough credits. Upgrade your plan to get more."
        case .tierRequired(let t):   return "This feature requires a \(t.displayName) subscription."
        }
    }
}

// Used for endpoints that return 200 with no body we care about
private struct EmptyResponse: Decodable {}
