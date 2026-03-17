import SwiftUI
import RevenueCat

@main
struct GCImageAIApp: App {
    @StateObject private var auth = AuthManager.shared

    init() {
        // Configure RevenueCat — public key only, no secrets here
        Purchases.logLevel = .debug
        Purchases.configure(withAPIKey: "test_DSVjgvqfgizAaTiaIsfcgzqzcua")

        // If the user is already signed in, link their purchases in RC
        if let userId = Keychain.userId {
            Purchases.shared.logIn(userId) { _, _, _ in }
        }
    }

    var body: some Scene {
        WindowGroup {
            if auth.isAuthenticated {
                ContentView()
                    .environmentObject(auth)
            } else {
                SignInView()
                    .environmentObject(auth)
            }
        }
    }
}
