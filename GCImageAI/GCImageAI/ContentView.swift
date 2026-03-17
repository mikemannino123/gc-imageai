import SwiftUI

struct ContentView: View {
    @EnvironmentObject var auth: AuthManager

    var body: some View {
        TabView {
            AccountView()
                .tabItem {
                    Label("Account", systemImage: "person.circle")
                }

            NavigationStack {
                HistoryView()
            }
            .tabItem {
                Label("History", systemImage: "clock")
            }
        }
        .preferredColorScheme(.dark)
    }
}
