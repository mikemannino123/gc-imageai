import Foundation
import AuthenticationServices
import Combine

@MainActor
final class AuthManager: NSObject, ObservableObject {
    static let shared = AuthManager()

    @Published var currentUser: User?
    @Published var isAuthenticated = false
    @Published var isLoading = false
    @Published var errorMessage: String?

    override private init() {
        super.init()
        // Restore session from Keychain on init
        if Keychain.jwt != nil {
            isAuthenticated = true
            Task { await refreshMe() }
        }
    }

    // MARK: - Sign In

    func signIn(from viewController: UIViewController) {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = viewController as? ASAuthorizationControllerPresentationContextProviding
        isLoading = true
        errorMessage = nil
        controller.performRequests()
    }

    // MARK: - Sign Out

    func signOut() {
        Keychain.jwt = nil
        Keychain.userId = nil
        currentUser = nil
        isAuthenticated = false
    }

    // MARK: - Refresh profile

    func refreshMe() async {
        do {
            let me = try await APIClient.shared.getMe()
            currentUser = me.user
            isAuthenticated = true
        } catch {
            // If the JWT is expired/invalid, clear state
            if let appErr = error as? AppError, case .notAuthenticated = appErr {
                signOut()
            }
        }
    }

    // MARK: - Internal: handle Apple credential

    private func handleCredential(_ credential: ASAuthorizationAppleIDCredential) async {
        guard let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            errorMessage = "Apple Sign-In failed: missing identity token."
            isLoading = false
            return
        }

        let fullName: String? = {
            guard let n = credential.fullName else { return nil }
            return [n.givenName, n.familyName].compactMap { $0 }.joined(separator: " ")
        }()

        do {
            let auth = try await APIClient.shared.appleSignIn(
                identityToken: token,
                fullName: fullName,
                email: credential.email
            )
            Keychain.jwt = auth.token
            Keychain.userId = auth.user.id
            currentUser = auth.user
            isAuthenticated = true
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - ASAuthorizationControllerDelegate

extension AuthManager: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else { return }
        Task { @MainActor in await handleCredential(credential) }
    }

    nonisolated func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        Task { @MainActor in
            if (error as NSError).code != ASAuthorizationError.canceled.rawValue {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
}
