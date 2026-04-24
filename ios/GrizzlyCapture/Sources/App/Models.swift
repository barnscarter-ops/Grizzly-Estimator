import Foundation

struct AuthResponse: Decodable {
    let ok: Bool
    let email: String?
}

struct DashboardResponse: Decodable {
    let projects: [ProjectSummary]
}

struct ProjectSummary: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let customer: CustomerSummary
    let projectType: String
    let projectSubtype: String
    let scopeDescription: String
}

struct CustomerSummary: Decodable, Hashable {
    let name: String
    let address: String
}

struct UploadResponse: Decodable {
    let attachment: UploadedAttachment
    let project: ProjectSummaryEnvelope
}

struct UploadedAttachment: Decodable, Hashable {
    let id: String
    let kind: String
    let name: String
    let sizeLabel: String
    let previewUrl: String?
}

struct ProjectSummaryEnvelope: Decodable, Hashable {
    let id: String
    let title: String
}
