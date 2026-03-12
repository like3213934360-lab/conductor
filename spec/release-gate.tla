---- MODULE release-gate ----
EXTENDS Naturals, Sequences

VARIABLES runStatus, traceBundle, releaseAttestation, policyReport, invariantReport, releaseDossier, releaseBundle

CompletedRequiresProofChain ==
  runStatus = "completed" =>
    /\ traceBundle # NULL
    /\ releaseAttestation # NULL
    /\ policyReport # NULL
    /\ invariantReport # NULL
    /\ releaseDossier # NULL
    /\ releaseBundle # NULL

BundleRequiresDossier ==
  releaseBundle # NULL => releaseDossier # NULL

AttestationRequiresTraceBundle ==
  releaseAttestation # NULL => traceBundle # NULL

====
