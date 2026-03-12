---- MODULE artifact-proof ----
EXTENDS Naturals, Sequences

VARIABLES traceBundleDigest, attestationDigest, policyReportDigest, invariantReportDigest, releaseDossierDigest, releaseBundleDigest, certificationDigest

BundleRequiresArtifactDigests ==
  releaseBundleDigest # NULL =>
    /\ traceBundleDigest # NULL
    /\ attestationDigest # NULL
    /\ policyReportDigest # NULL
    /\ invariantReportDigest # NULL
    /\ releaseDossierDigest # NULL

CertificationRequiresBundle ==
  certificationDigest # NULL => releaseBundleDigest # NULL

====
