# Kubernetes manifests (examples)

Reference manifests — **not** wired to any cluster. Review and adjust placeholders
(`REGISTRY/...` image, hostnames, storageClass, namespace labels, Prometheus
`release` label) before using.

## Apply order
```sh
kubectl apply -f namespace.yaml
# Create the Secret from real values (prefer sealed-secrets / SOPS over committing it):
kubectl apply -f secret.example.yaml      # after replacing the placeholders
kubectl apply -f pvc.yaml
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f ingress.yaml             # internal-only; provide TLS
# Egress allowlist — pick ONE for your CNI:
kubectl apply -f ciliumnetworkpolicy.yaml # Cilium: per-host FQDN egress (preferred)
# kubectl apply -f networkpolicy.yaml     # generic CNI: broad 443 egress
# Monitoring (Prometheus Operator):
kubectl apply -f servicemonitor.yaml
kubectl apply -f ../monitoring/prometheus-rules.yaml
```

## Notes
- **Single replica only** — SQLite is one writer; the Deployment uses `Recreate`.
- **Image:** build and push from the repo root (`docker build -t REGISTRY/library-card-tracker:0.1.0 .`), then set that ref in `deployment.yaml`.
- **Master key:** the Secret's `LIBCARD_MASTER_KEY` decrypts every stored PIN. Back it up out-of-band; keep it out of DB backups.
- **Hardening included:** non-root, read-only root FS (writable `/data`, `/tmp`, `/dev/shm`), dropped capabilities, seccomp RuntimeDefault, resource limits.
