import UIKit
import Messages
import SwiftUI

/// Thin UIKit wrapper that hosts GeneratorView (SwiftUI) and holds the conversation reference.
final class GeneratorViewController: UIViewController {

    var activeConversation: MSConversation?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let generatorView = GeneratorView { [weak self] imageURL in
            guard let self, let conversation = self.activeConversation else { return }
            Task { await self.insertImage(from: imageURL, into: conversation) }
        }

        let host = UIHostingController(rootView: generatorView)
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
    }

    // MARK: - Insert into conversation

    @MainActor
    private func insertImage(from urlString: String, into conversation: MSConversation) async {
        guard let url = URL(string: urlString) else { return }

        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            guard let image = UIImage(data: data) else { return }

            // Write to a temp file — MSConversation.insertAttachment needs a URL
            let tmpURL = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension("png")

            if let pngData = image.pngData() {
                try pngData.write(to: tmpURL)
            }

            conversation.insertAttachment(tmpURL, withAlternateFilename: "gcimageai.png") { error in
                if let error {
                    print("[GCImageAI] Insert attachment error: \(error)")
                }
                // Clean up temp file
                try? FileManager.default.removeItem(at: tmpURL)
            }
        } catch {
            print("[GCImageAI] Failed to download/insert image: \(error)")
        }
    }
}
