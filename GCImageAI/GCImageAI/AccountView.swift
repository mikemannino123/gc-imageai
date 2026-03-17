import SwiftUI

struct AccountView: View {
    @EnvironmentObject var auth: AuthManager
    @State private var meData: MeResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                if isLoading {
                    ProgressView()
                        .tint(.white)
                } else if let me = meData {
                    List {
                        Section {
                            HStack {
                                Image(systemName: "person.circle.fill")
                                    .font(.system(size: 44))
                                    .foregroundColor(.gray)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(me.user.fullName ?? "User")
                                        .font(.headline)
                                    Text(me.user.email ?? "")
                                        .font(.caption)
                                        .foregroundColor(.gray)
                                }
                            }
                            .padding(.vertical, 6)
                        }

                        Section("Plan") {
                            HStack {
                                Text("Tier")
                                Spacer()
                                Text(me.user.tier.displayName)
                                    .foregroundColor(.secondary)
                            }
                            HStack {
                                Text("Credits Remaining")
                                Spacer()
                                Text("\(me.creditBalance)")
                                    .foregroundColor(.secondary)
                            }
                            if let sub = me.subscription {
                                HStack {
                                    Text("Status")
                                    Spacer()
                                    Text(sub.status.capitalized)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }

                        Section {
                            Button(role: .destructive) {
                                auth.signOut()
                            } label: {
                                Text("Sign Out")
                            }
                        }
                    }
                    .scrollContentBackground(.hidden)
                }

                if let error = errorMessage {
                    Text(error)
                        .font(.footnote)
                        .foregroundColor(.red)
                        .padding()
                }
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.large)
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            meData = try await APIClient.shared.getMe()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
