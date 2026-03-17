import Foundation
import Security

enum Keychain {
    private static let service = "com.michaelmannino.gcimageai"

    static func save(_ value: String, key: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String:   data,
        ]
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }

    static func load(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String:            kSecClassGenericPassword,
            kSecAttrService as String:      service,
            kSecAttrAccount as String:      key,
            kSecReturnData as String:       true,
            kSecMatchLimit as String:       kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(key: String) {
        let query: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

// MARK: - Convenience keys
extension Keychain {
    static let jwtKey   = "jwt_token"
    static let userIdKey = "user_id"

    static var jwt: String?   { get { load(key: jwtKey) }   set { newValue.map { save($0, key: jwtKey) } ?? delete(key: jwtKey) } }
    static var userId: String? { get { load(key: userIdKey) } set { newValue.map { save($0, key: userIdKey) } ?? delete(key: userIdKey) } }
}
