import SwiftUI

struct HistoryView: View {
    @State private var generations: [GenerationRecord] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let columns = [GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if isLoading && generations.isEmpty {
                ProgressView().tint(.white)
            } else if generations.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 48))
                        .foregroundColor(.gray)
                    Text("No generations yet")
                        .foregroundColor(.gray)
                    Text("Open iMessage and type a prompt to get started.")
                        .font(.caption)
                        .foregroundColor(.gray)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                }
            } else {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: 2) {
                        ForEach(generations) { gen in
                            if let urlStr = gen.imageUrl, let url = URL(string: urlStr) {
                                AsyncImage(url: url) { image in
                                    image.resizable().scaledToFill()
                                } placeholder: {
                                    Rectangle()
                                        .fill(Color.gray.opacity(0.3))
                                        .overlay(ProgressView().tint(.white))
                                }
                                .frame(minWidth: 0, maxWidth: .infinity)
                                .aspectRatio(1, contentMode: .fill)
                                .clipped()
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("History")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            generations = try await APIClient.shared.history()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
