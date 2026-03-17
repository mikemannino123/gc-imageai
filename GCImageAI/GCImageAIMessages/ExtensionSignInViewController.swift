import UIKit
import AuthenticationServices
import SwiftUI

/// Sign-in screen shown inside the iMessage extension when no JWT is stored.
final class ExtensionSignInViewController: UIViewController {

    var onSignedIn: (() -> Void)?

    private var isLoading = false {
        didSet { updateUI() }
    }
    private var errorLabel = UILabel()
    private var signInButton: ASAuthorizationAppleIDButton!
    private var spinner = UIActivityIndicatorView(style: .medium)

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildUI()
    }

    // MARK: - Build UI

    private func buildUI() {
        // Icon
        let icon = UIImageView(image: UIImage(systemName: "photo.stack.fill"))
        icon.tintColor = .white
        icon.contentMode = .scaleAspectFit
        icon.translatesAutoresizingMaskIntoConstraints = false

        let titleLabel = UILabel()
        titleLabel.text = "GC ImageAI"
        titleLabel.font = .boldSystemFont(ofSize: 22)
        titleLabel.textColor = .white
        titleLabel.translatesAutoresizingMaskIntoConstraints = false

        let subtitleLabel = UILabel()
        subtitleLabel.text = "Sign in to generate AI images"
        subtitleLabel.font = .systemFont(ofSize: 14)
        subtitleLabel.textColor = .gray
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false

        errorLabel.font = .systemFont(ofSize: 12)
        errorLabel.textColor = .systemRed
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.translatesAutoresizingMaskIntoConstraints = false
        errorLabel.isHidden = true

        signInButton = ASAuthorizationAppleIDButton(authorizationButtonType: .signIn,
                                                    authorizationButtonStyle: .white)
        signInButton.addTarget(self, action: #selector(tappedSignIn), for: .touchUpInside)
        signInButton.translatesAutoresizingMaskIntoConstraints = false

        spinner.color = .white
        spinner.hidesWhenStopped = true
        spinner.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(icon)
        view.addSubview(titleLabel)
        view.addSubview(subtitleLabel)
        view.addSubview(errorLabel)
        view.addSubview(signInButton)
        view.addSubview(spinner)

        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -80),
            icon.widthAnchor.constraint(equalToConstant: 48),
            icon.heightAnchor.constraint(equalToConstant: 48),

            titleLabel.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 12),
            titleLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),

            subtitleLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 6),
            subtitleLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),

            errorLabel.topAnchor.constraint(equalTo: subtitleLabel.bottomAnchor, constant: 12),
            errorLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            errorLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),

            signInButton.topAnchor.constraint(equalTo: errorLabel.bottomAnchor, constant: 20),
            signInButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            signInButton.widthAnchor.constraint(equalToConstant: 240),
            signInButton.heightAnchor.constraint(equalToConstant: 44),

            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.topAnchor.constraint(equalTo: signInButton.bottomAnchor, constant: 12),
        ])
    }

    private func updateUI() {
        signInButton.isHidden = isLoading
        isLoading ? spinner.startAnimating() : spinner.stopAnimating()
    }

    // MARK: - Sign In

    @objc private func tappedSignIn() {
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        isLoading = true
        errorLabel.isHidden = true
        controller.performRequests()
    }

    private func showError(_ message: String) {
        errorLabel.text = message
        errorLabel.isHidden = false
        isLoading = false
    }
}

// MARK: - ASAuthorizationControllerDelegate

extension ExtensionSignInViewController: ASAuthorizationControllerDelegate {
    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            showError("Sign-in failed: missing identity token.")
            return
        }

        let fullName: String? = {
            guard let n = credential.fullName else { return nil }
            return [n.givenName, n.familyName].compactMap { $0 }.joined(separator: " ")
        }()

        Task {
            do {
                let auth = try await APIClient.shared.appleSignIn(
                    identityToken: token,
                    fullName: fullName,
                    email: credential.email
                )
                Keychain.jwt = auth.token
                Keychain.userId = auth.user.id
                await MainActor.run {
                    isLoading = false
                    onSignedIn?()
                }
            } catch {
                await MainActor.run { showError(error.localizedDescription) }
            }
        }
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        let nsError = error as NSError
        if nsError.code != ASAuthorizationError.canceled.rawValue {
            showError(error.localizedDescription)
        } else {
            isLoading = false
        }
    }
}

// MARK: - ASAuthorizationControllerPresentationContextProviding

extension ExtensionSignInViewController: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        view.window ?? UIWindow()
    }
}
