import SwiftUI

struct ProjectPickerView: View {
    @Bindable var model: AppModel

    var body: some View {
        List {
            ForEach(model.projects) { project in
                Button {
                    model.selectedProject = project
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(project.customer.name)
                            .font(.headline)
                        Text(project.title)
                            .font(.subheadline)
                        Text("\(project.projectType.capitalized) • \(project.projectSubtype.replacingOccurrences(of: "_", with: " "))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(project.customer.address)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .listRowBackground(
                    model.selectedProject?.id == project.id
                        ? Color.orange.opacity(0.12)
                        : Color.clear
                )
            }
        }
        .overlay {
            if model.projects.isEmpty && !model.isLoading {
                ContentUnavailableView(
                    "No projects yet",
                    systemImage: "tray",
                    description: Text("Create or seed projects from the web app first.")
                )
            }
        }
        .navigationTitle("Projects")
        .task {
            if model.projects.isEmpty {
                await model.loadProjects()
            }
        }
        .refreshable {
            await model.loadProjects()
        }
    }
}
