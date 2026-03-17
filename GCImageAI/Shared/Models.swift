import Foundation

// MARK: - User

struct User: Codable {
    let id: String
    let email: String?
    let fullName: String?
    let tier: UserTier
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, email, tier
        case fullName = "full_name"
        case createdAt = "created_at"
    }
}

enum UserTier: String, Codable {
    case free, pro, ultra

    var canUseImageToImage: Bool { self == .ultra }
    var displayName: String {
        switch self {
        case .free:  return "Free"
        case .pro:   return "Pro"
        case .ultra: return "Ultra"
        }
    }
}

// MARK: - Generation

struct GenerationResponse: Codable {
    let imageUrl: String
    let creditsRemaining: Int
    let generationId: String

    enum CodingKeys: String, CodingKey {
        case imageUrl = "imageUrl"
        case creditsRemaining = "creditsRemaining"
        case generationId = "generationId"
    }
}

struct GenerationRecord: Codable, Identifiable {
    let id: String
    let prompt: String
    let type: String
    let status: String
    let imageUrl: String?
    let creditsUsed: Int
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, prompt, type, status
        case imageUrl = "image_url"
        case creditsUsed = "credits_used"
        case createdAt = "created_at"
    }
}

// MARK: - Me response

struct MeResponse: Codable {
    let user: User
    let creditBalance: Int
    let subscription: SubscriptionRecord?

    enum CodingKeys: String, CodingKey {
        case user
        case creditBalance = "creditBalance"
        case subscription
    }
}

struct SubscriptionRecord: Codable {
    let tier: String
    let status: String
    let expiresDate: String?

    enum CodingKeys: String, CodingKey {
        case tier, status
        case expiresDate = "expires_date"
    }
}

// MARK: - Auth

struct AuthResponse: Codable {
    let token: String
    let expiresIn: String
    let user: User
    let isNewUser: Bool

    enum CodingKeys: String, CodingKey {
        case token, user
        case expiresIn = "expiresIn"
        case isNewUser = "isNewUser"
    }
}

// MARK: - API Error

struct APIError: Codable, LocalizedError {
    struct ErrorBody: Codable {
        let code: String
        let message: String
    }
    let error: ErrorBody

    var errorDescription: String? { error.message }
}
