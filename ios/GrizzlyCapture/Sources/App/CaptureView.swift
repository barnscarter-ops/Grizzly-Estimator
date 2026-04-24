import SwiftUI

struct CaptureView: View {
    @Bindable var model: AppModel
    @State private var showingRecorder = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if let project = model.selectedProject {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Selected job")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(project.customer.name)
                        .font(.title2.weight(.semibold))
                    Text(project.title)
                        .font(.body)
                    Text(project.scopeDescription)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 24))
            } else {
                ContentUnavailableView(
                    "Choose a project",
                    systemImage: "briefcase",
                    description: Text("Pick a job from the Projects tab before recording.")
                )
            }

            VStack(alignment: .leading, spacing: 12) {
                Text("Walkthrough capture")
                    .font(.headline)
                Text("Record the walkthrough with voiceover, then upload it straight into persistent project storage.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Button {
                    showingRecorder = true
                } label: {
                    Label("Record walkthrough", systemImage: "video.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.selectedProject == nil || model.isUploading)
            }
            .padding()
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 24))

            if !model.uploadMessage.isEmpty {
                Text(model.uploadMessage)
                    .font(.footnote)
                    .foregroundStyle(model.uploadMessage.lowercased().contains("uploaded") ? .green : .red)
                    .padding(.horizontal)
            }

            Spacer()
        }
        .padding()
        .navigationTitle("Capture")
        .sheet(isPresented: $showingRecorder) {
            CameraRecorder(isPresented: $showingRecorder) { url in
                Task {
                    await model.uploadCapturedVideo(url)
                }
            }
        }
    }
}
