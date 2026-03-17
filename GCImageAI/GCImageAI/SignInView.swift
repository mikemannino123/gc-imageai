import SwiftUI
import AuthenticationServices

struct SignInView: View {
    @EnvironmentObject var auth: AuthManager

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 40) {
                Spacer()

                VStack(spacing: 12) {
                    Image(systemName: "photo.stack.fill")
                        .font(.system(size: 64))
                        .foregroundColor(.white)
                    Text("GC ImageAI")
                        .font(.largeTitle.bold())
                        .foregroundColor(.white)
                    Text("AI images, right in your messages.")
                        .font(.subheadline)
                        .foregroundColor(.gray)
                }

                Spacer()

                VStack(spacing: 16) {
                    if let error = auth.errorMessage {
                        Text(error)
                            .font(.footnote)
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                    }

                    if auth.isLoading {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(.white)
                    } else {
                        SignInWithAppleButton(.signIn) { request in
                            request.requestedScopes = [.fullName, .email]
                        } onCompletion: { result in
                            // Handled by AuthManager's ASAuthorizationControllerDelegate
                        }
                        .signInWithAppleButtonStyle(.white)
                        .frame(height: 50)
                        .padding(.horizontal, 40)
                        .onTapGesture {
                            // Route through AuthManager so delegate is set correctly
                            // We use the SwiftUI ASAuthorizationAppleIDButton directly
                            // AuthManager.signIn() is used from UIKit contexts (extension)
                        }

                        // Use the SwiftUI-native button directly
                        SignInWithAppleButton(.signIn) { request in
                            request.requestedScopes = [.fullName, .email]
                        } onCompletion: { result in
                            handleAppleResult(result)
                        }
                        .signInWithAppleButtonStyle(.white)
                        .frame(height: 50)
                        .padding(.horizontal, 40)
                    }
                }
                .padding(.bottom, 60)
            }
        }
    }

    private func handleAppleResult(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let auth):
            guard let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let token = String(data: tokenData, encoding: .utf8) else { return }

            let fullName: String? = {
                guard let n = credential.fullName else { return nil }
                return [n.givenName, n.familyName].compactMap { $0 }.joined(separator: " ")
            }()

            Task {
                do {
                    let authResp = try await APIClient.shared.appleSignIn(
                        identityToken: token,
                        fullName: fullName,
                        email: credential.email
                    )
                    Keychain.jwt = authResp.token
                    Keychain.userId = authResp.user.id
                    // Link purchases in RevenueCat
                    await withCheckedContinuation { cont in
                        RevenueCatBridge.logIn(userId: authResp.user.id) {
                            cont.resume()
                        }
                    }
                    await AuthManager.shared.refreshMe()
                } catch {
                    await MainActor.run {
                        AuthManager.shared.errorMessage = error.localizedDescription
                    }
                }
            }

        case .failure(let error):
            let nsError = error as NSError
            if nsError.code != ASAuthorizationError.canceled.rawValue {
                AuthManager.shared.errorMessage = error.localizedDescription
            }
        }
    }
}

// Thin bridge to avoid importing RevenueCat inside the shared layer
enum RevenueCatBridge {
    static func logIn(userId: String, completion: @escaping () -> Void) {
        // Import RevenueCat at call site only — keeps Shared/ framework-free
        RevenueCat.Purchases.shared.logIn(userId) { _, _, _ in completion() }
    }
}
