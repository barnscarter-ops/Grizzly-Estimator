import SwiftUI

struct LoginView: View {
    @Bindable var model: AppModel

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Secure workspace")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text("Sign in to Grizzly Estimator")
                        .font(.largeTitle.weight(.bold))
                    Text("Projects, uploads, and proposal links are now protected by the same authenticated session as the web workspace.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }

                VStack(alignment: .leading, spacing: 14) {
                    TextField("Email", text: $model.email)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding()
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))

                    SecureField("Password", text: $model.password)
                        .padding()
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))

                    Button {
                        Task {
                            await model.signIn()
                        }
                    } label: {
                        if model.isLoading {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("Sign In")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(model.email.isEmpty || model.password.isEmpty || model.isLoading)
                }

                if !model.authMessage.isEmpty {
                    Text(model.authMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Sign In")
        }
    }
}
