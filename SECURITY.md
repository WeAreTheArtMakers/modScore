# Security

modScore processes scores in the browser and stores the local library in IndexedDB. Do not post private scores, tokens or personal data in public issues. Export library backups before clearing site data.

For a security issue, use the repository's private vulnerability reporting feature if available. Otherwise contact the maintainers through the [WeAreTheArtMakers GitHub profile](https://github.com/WeAreTheArtMakers) before publishing exploit details. Ordinary bugs belong in Issues.

The maintained line is 0.5.x. Browser security updates remain necessary. PDF.js, runtime libraries and model artifacts are pinned; dependency updates must preserve integrity verification and the matching worker/main versions.

The optional YouTube helper is explicitly started by the user and binds to loopback only. It accepts a limited origin set, HTTPS YouTube video IDs, JSON requests and a single bounded download job. Downloader commands use argument arrays; temporary paths are canonicalized before reading. It does not use browser cookies or credentials. Do not expose port 8790 through a proxy or bind it to a public interface. Public YouTube availability and the user's installed downloader remain external dependencies.
