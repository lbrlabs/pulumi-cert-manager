import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";


let config = new pulumi.Config()

const stack = pulumi.getStack()
const clusterProject = config.require("clusterProject")
const stackRef = `jaxxstorm/${clusterProject}/${stack}`;

const cluster = new pulumi.StackReference(stackRef); // # FIXME: make configurable
const provider = new k8s.Provider("k8s", { kubeconfig: cluster.getOutput("kubeConfig") });

const ns = config.get("namespace") || "cert-manager"
const emailAddress = config.require("emailAddress")
const ingressClass = config.get("ingressClass") || "nginx"
const apiToken = config.require("apiToken")
const dnsNames = config.get("dnsNames")

const namespace = new k8s.core.v1.Namespace("ns", {
    metadata: {
        name: ns,
    }
}, { provider: provider });

const crds = new k8s.yaml.ConfigFile("crds", {
    file: "https://github.com/jetstack/cert-manager/releases/download/v0.14.1/cert-manager.crds.yaml",
}, { provider: provider })

const certManager = new k8s.helm.v2.Chart("cert-manager",
    {
        namespace: namespace.metadata.name,
        chart: "cert-manager",
        version: "v0.14.2",
        fetchOpts: { repo: "https://charts.jetstack.io" },
        values: {}
    },
    {
        providers: { kubernetes: provider },
        dependsOn: [crds]
    },
)

const cloudflareKey = new k8s.core.v1.Secret("cloudflare", {
    metadata: { namespace: namespace.metadata.name },
    stringData: { 
        "api-key": apiToken,
    },
}, { provider: provider });
const cloudflareKeyName = cloudflareKey.metadata.apply(m => m.name);

// FIXME: This would be good as a library
const clusterIssuer = new k8s.apiextensions.CustomResource("acme", {
    apiVersion: "cert-manager.io/v1alpha2",
    kind: "ClusterIssuer",
    metadata: {
        name: "letsencrypt",
    },
    spec: {
        acme: {
            server: "https://acme-v02.api.letsencrypt.org/directory",
            email: emailAddress,
            privateKeySecretRef: {
                name: "letsencrypt",
            },
            solvers: [
                { http01: { ingress: { class: ingressClass } } },
                { dns01: { cloudflare: { email: emailAddress, apiKeySecretRef: { name: cloudflareKeyName, key: "api-key" } } }, selector: { dnsNames: [dnsNames] } },
            ],
        }
    }
},
    {
        provider: provider,
        dependsOn: [crds]
    })

