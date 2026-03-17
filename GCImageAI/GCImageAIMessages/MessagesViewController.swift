import UIKit
import Messages

final class MessagesViewController: MSMessagesAppViewController {

    private var hostingVC: UIViewController?

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        showRoot()
    }

    // MARK: - MSMessagesAppViewController

    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        showRoot()
    }

    override func didResignActive(with conversation: MSConversation) {
        super.didResignActive(with: conversation)
    }

    // MARK: - Root view decision

    private func showRoot() {
        removeHosted()

        if Keychain.jwt != nil {
            showGenerator()
        } else {
            showSignIn()
        }
    }

    private func showSignIn() {
        let vc = ExtensionSignInViewController()
        vc.onSignedIn = { [weak self] in
            self?.showGenerator()
        }
        embed(vc)
    }

    private func showGenerator() {
        let vc = GeneratorViewController()
        vc.activeConversation = activeConversation
        embed(vc)
    }

    // MARK: - Helpers

    private func embed(_ vc: UIViewController) {
        removeHosted()
        addChild(vc)
        vc.view.frame = view.bounds
        vc.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(vc.view)
        vc.didMove(toParent: self)
        hostingVC = vc
    }

    private func removeHosted() {
        hostingVC?.willMove(toParent: nil)
        hostingVC?.view.removeFromSuperview()
        hostingVC?.removeFromParent()
        hostingVC = nil
    }
}
