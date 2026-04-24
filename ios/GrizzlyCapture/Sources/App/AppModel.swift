import Foundation
import Observation

@Observable
final class AppModel {
    var projects: [ProjectSummary] = []
    var selectedProject: ProjectSummary?
    var isLoading = false
    var isUploading = false
    var isAuthenticated = false
    var email = ""
    var password = ""
    var authMessage = ""
    var uploadMessage = ""
    var lastCapturedURL: URL?
    var errorMessage = ""

    private let apiClient = APIClient(baseURL: AppConfig.apiBaseURL)

    func signIn() async {
        isLoading = true
        defer { isLoading = false }

        do {
            _ = try await apiClient.login(email: email, password: password)
            isAuthenticated = true
            authMessage = ""
            errorMessage = ""
            password = ""
            await loadProjects()
        } catch {
            isAuthenticated = false
            authMessage = error.localizedDescription
        }
    }

    func signOut() async {
        do {
            try await apiClient.logout()
        } catch {
            authMessage = error.localizedDescription
        }

        isAuthenticated = false
        projects = []
        selectedProject = nil
        uploadMessage = ""
        lastCapturedURL = nil
    }

    func loadProjects() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let loadedProjects = try await apiClient.loadProjects()
            projects = loadedProjects
            selectedProject = selectedProject ?? loadedProjects.first
            errorMessage = ""
            authMessage = ""
            isAuthenticated = true
        } catch {
            let nsError = error as NSError

            if nsError.code == 401 {
                isAuthenticated = false
                authMessage = "Your session expired. Sign in again to keep customer data protected."
                projects = []
                selectedProject = nil
                return
            }

            errorMessage = error.localizedDescription
        }
    }

    func uploadCapturedVideo(_ fileURL: URL) async {
        guard let selectedProject else {
            uploadMessage = "Choose a project before uploading."
            return
        }

        isUploading = true
        defer { isUploading = false }

        do {
            let response = try await apiClient.uploadWalkthrough(
                projectID: selectedProject.id,
                fileURL: fileURL
            )
            uploadMessage = "Uploaded \(response.attachment.name) to \(selectedProject.customer.name)."
            lastCapturedURL = fileURL
        } catch {
            let nsError = error as NSError

            if nsError.code == 401 {
                isAuthenticated = false
                authMessage = "Your session expired. Sign in again before uploading."
                uploadMessage = ""
                return
            }

            uploadMessage = error.localizedDescription
        }
    }
}
