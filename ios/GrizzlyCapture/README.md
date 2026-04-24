# GrizzlyCapture iPhone App

Native iPhone capture specialist for the Grizzly Estimator backend.

## What is included

- SwiftUI app scaffold targeting iOS 17+
- Authenticated sign-in flow that shares the secured workspace session
- Project picker backed by the web app's `/api/projects` endpoint
- Native video capture using `UIImagePickerController`
- Multipart upload flow to `/api/uploads`
- Small, focused SwiftUI views following the session's SwiftUI skill guidance

## Generate the Xcode project

This folder uses XcodeGen to keep the scaffold text-based in this repo.

```bash
brew install xcodegen
cd ios/GrizzlyCapture
xcodegen generate
open GrizzlyCapture.xcodeproj
```

## Configure

Set the backend base URL in `Sources/App/AppConfig.swift`.

The iPhone app now requires the same admin email/password sign-in as the web workspace before it can load projects or upload media.

For local simulator testing, point it at a reachable machine hostname rather than `localhost`.
