import SwiftUI
import PhotosUI

struct GeneratorView: View {
    let onImageReady: (String) -> Void

    @State private var prompt = ""
    @State private var selectedImage: UIImage?
    @State private var pickerItem: PhotosPickerItem?
    @State private var isGenerating = false
    @State private var errorMessage: String?
    @State private var currentUser: User?
    @State private var creditBalance: Int = 0

    private var canUseImageToImage: Bool { currentUser?.tier == .ultra }
    private var creditsNeeded: Int { selectedImage != nil ? 2 : 1 }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                headerBar

                Divider().background(Color.gray.opacity(0.3))

                ScrollView {
                    VStack(spacing: 16) {
                        promptField
                        if canUseImageToImage { imagePickerSection }
                        if let error = errorMessage {
                            errorBanner(error)
                        }
                        generateButton
                    }
                    .padding(16)
                }
            }
        }
        .task { await loadUser() }
        .onChange(of: pickerItem) { _, item in
            Task { await loadImage(from: item) }
        }
    }

    // MARK: - Sub-views

    private var headerBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("GC ImageAI")
                    .font(.headline)
                    .foregroundColor(.white)
                Text("\(creditBalance) credits")
                    .font(.caption)
                    .foregroundColor(.gray)
            }
            Spacer()
            if let tier = currentUser?.tier {
                Text(tier.displayName)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(tierColor(tier).opacity(0.2))
                    .foregroundColor(tierColor(tier))
                    .clipShape(Capsule())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var promptField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Prompt")
                .font(.caption.weight(.medium))
                .foregroundColor(.gray)
            TextField("Describe the image…", text: $prompt, axis: .vertical)
                .lineLimit(3...5)
                .padding(10)
                .background(Color.white.opacity(0.08))
                .cornerRadius(10)
                .foregroundColor(.white)
        }
    }

    private var imagePickerSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Reference Image (optional)")
                .font(.caption.weight(.medium))
                .foregroundColor(.gray)

            PhotosPicker(selection: $pickerItem, matching: .images) {
                if let img = selectedImage {
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: img)
                            .resizable()
                            .scaledToFill()
                            .frame(height: 120)
                            .clipped()
                            .cornerRadius(10)
                        Button {
                            selectedImage = nil
                            pickerItem = nil
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.white)
                                .background(Color.black.opacity(0.6))
                                .clipShape(Circle())
                        }
                        .padding(6)
                    }
                } else {
                    HStack {
                        Image(systemName: "photo.badge.plus")
                        Text("Add photo to remix")
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(Color.white.opacity(0.08))
                    .cornerRadius(10)
                    .foregroundColor(.gray)
                }
            }
        }
    }

    private func errorBanner(_ message: String) -> some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.red)
            Text(message)
                .font(.footnote)
                .foregroundColor(.red)
        }
        .padding(10)
        .background(Color.red.opacity(0.1))
        .cornerRadius(8)
    }

    private var generateButton: some View {
        Button {
            Task { await generate() }
        } label: {
            HStack(spacing: 8) {
                if isGenerating {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(.black)
                        .scaleEffect(0.8)
                    Text("Generating…")
                } else {
                    Image(systemName: "sparkles")
                    Text("Generate  •  \(creditsNeeded) credit\(creditsNeeded == 1 ? "" : "s")")
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background(isGenerating || prompt.trimmingCharacters(in: .whitespaces).isEmpty
                ? Color.gray.opacity(0.3)
                : Color.white)
            .foregroundColor(isGenerating || prompt.trimmingCharacters(in: .whitespaces).isEmpty
                ? Color.gray
                : Color.black)
            .cornerRadius(12)
            .font(.headline)
        }
        .disabled(isGenerating || prompt.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    // MARK: - Actions

    private func generate() async {
        guard !prompt.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        isGenerating = true
        errorMessage = nil

        do {
            let result: GenerationResponse
            if let img = selectedImage {
                result = try await APIClient.shared.generate(prompt: prompt, image: img)
            } else {
                result = try await APIClient.shared.generate(prompt: prompt)
            }
            creditBalance = result.creditsRemaining
            prompt = ""
            selectedImage = nil
            pickerItem = nil
            onImageReady(result.imageUrl)
        } catch {
            errorMessage = error.localizedDescription
        }
        isGenerating = false
    }

    private func loadUser() async {
        do {
            let me = try await APIClient.shared.getMe()
            currentUser = me.user
            creditBalance = me.creditBalance
        } catch {}
    }

    private func loadImage(from item: PhotosPickerItem?) async {
        guard let item else { return }
        do {
            if let data = try await item.loadTransferable(type: Data.self) {
                selectedImage = UIImage(data: data)
            }
        } catch {
            errorMessage = "Couldn't load photo."
        }
    }

    // MARK: - Helpers

    private func tierColor(_ tier: UserTier) -> Color {
        switch tier {
        case .free:  return .gray
        case .pro:   return .blue
        case .ultra: return .purple
        }
    }
}
