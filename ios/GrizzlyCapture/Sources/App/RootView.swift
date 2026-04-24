import SwiftUI

struct RootView: View {
    @State private var model = AppModel()

    var body: some View {
        Group {
            if model.isAuthenticated {
                TabView {
                    NavigationStack {
                        ProjectPickerView(model: model)
                            .toolbar {
                                ToolbarItem(placement: .topBarTrailing) {
                                    Button("Sign Out") {
                                        Task {
                                            await model.signOut()
                                        }
                                    }
                                }
                            }
                    }
                    .tabItem {
                        Label("Projects", systemImage: "list.bullet.rectangle")
                    }

                    NavigationStack {
                        CaptureView(model: model)
                            .toolbar {
                                ToolbarItem(placement: .topBarTrailing) {
                                    Button("Sign Out") {
                                        Task {
                                            await model.signOut()
                                        }
                                    }
                                }
                            }
                    }
                    .tabItem {
                        Label("Capture", systemImage: "video")
                    }
                }
            } else {
                LoginView(model: model)
            }
        }
    }
}
