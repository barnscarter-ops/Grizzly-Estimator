import Foundation
import UniformTypeIdentifiers

struct APIClient {
    let baseURL: URL

    func login(email: String, password: String) async throws -> AuthResponse {
        let endpoint = baseURL.appending(path: "api/auth/login")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode([
            "email": email,
            "password": password,
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(AuthResponse.self, from: data)
    }

    func logout() async throws {
        let endpoint = baseURL.appending(path: "api/auth/logout")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)
        try validate(response: response, data: data)
    }

    func loadProjects() async throws -> [ProjectSummary] {
        let url = baseURL.appending(path: "api/projects")
        let (data, response) = try await URLSession.shared.data(from: url)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(DashboardResponse.self, from: data).projects
    }

    func uploadWalkthrough(projectID: String, fileURL: URL) async throws -> UploadResponse {
        let endpoint = baseURL.appending(path: "api/uploads")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"

        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        let fileData = try Data(contentsOf: fileURL)
        let fileName = fileURL.lastPathComponent
        let mimeType = mimeTypeForFileURL(fileURL)

        var body = Data()
        appendField(named: "projectId", value: projectID, boundary: boundary, to: &body)
        appendField(named: "kind", value: "video", boundary: boundary, to: &body)
        appendFile(
            named: "file",
            fileName: fileName,
            mimeType: mimeType,
            fileData: fileData,
            boundary: boundary,
            to: &body
        )
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(UploadResponse.self, from: data)
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else { return }
        guard 200..<300 ~= httpResponse.statusCode else {
            let serverMessage = String(data: data, encoding: .utf8) ?? "Unknown server error"
            throw NSError(
                domain: "GrizzlyCapture.API",
                code: httpResponse.statusCode,
                userInfo: [NSLocalizedDescriptionKey: serverMessage]
            )
        }
    }

    private func appendField(named name: String, value: String, boundary: String, to body: inout Data) {
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(value)\r\n".data(using: .utf8)!)
    }

    private func appendFile(
        named name: String,
        fileName: String,
        mimeType: String,
        fileData: Data,
        boundary: String,
        to body: inout Data
    ) {
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append(
            "Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!
        )
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n".data(using: .utf8)!)
    }

    private func mimeTypeForFileURL(_ fileURL: URL) -> String {
        if let type = UTType(filenameExtension: fileURL.pathExtension) {
            return type.preferredMIMEType ?? "application/octet-stream"
        }

        return "application/octet-stream"
    }
}
