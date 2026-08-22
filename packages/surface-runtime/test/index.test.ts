import assert from "node:assert/strict";
import test from "node:test";

import {
  bindSurfaceInstance,
  defineSurfaceDefinition,
  renderSurface,
  type SurfaceApplicationReference,
  type SurfaceWorkReference,
} from "../src/index.ts";

const workspaceId = "workspace:acme";
const customerId = "workspace:acme/semantic-object:customer-42";
const work: SurfaceWorkReference = {
  id: "work-instance:onboard-customer-42",
  workspaceId,
  version: 7,
};

const crmApplication: SurfaceApplicationReference = {
  id: "application-instance:crm",
  workspaceId,
  semanticObjectBindings: { customer: customerId },
};

const supportApplication: SurfaceApplicationReference = {
  id: "application-instance:support",
  workspaceId,
  semanticObjectBindings: { customer: customerId },
};

test("two Apps render the same semantic identity through different authorized views", () => {
  const crmDefinition = defineSurfaceDefinition({
    id: "surface:crm-customer",
    revision: 1,
    audience: "internal",
    view: {
      binding: "customer",
      fields: ["name", "creditLimit"],
      readResource: "customer.private.read",
    },
    actionResources: ["customer.credit.update"],
    inspectMode: true,
  });
  const supportDefinition = defineSurfaceDefinition({
    id: "surface:support-customer",
    revision: 3,
    audience: "public",
    view: {
      binding: "customer",
      fields: ["status", "name"],
      readResource: "customer.public.read",
    },
    actionResources: ["support.request.create", "support.request.cancel"],
  });

  const crmSurface = bindSurfaceInstance({
    id: "surface-instance:crm-customer",
    definition: crmDefinition,
    application: crmApplication,
    work,
  });
  const supportSurface = bindSurfaceInstance({
    id: "surface-instance:support-customer",
    definition: supportDefinition,
    application: supportApplication,
    work,
  });
  const objects = [{
    id: customerId,
    version: 12,
    values: { status: "active", creditLimit: 50_000, name: "Harbor Labs" },
  }];

  const crmSnapshot = renderSurface({
    instance: crmSurface,
    work,
    objects,
    expectedWorkVersion: 7,
    now: "2026-08-22T12:00:00Z",
    authority: {
      kind: "internal",
      workspaceId,
      principalId: "principal:operator",
      readResources: ["customer.private.read"],
      actionResources: ["customer.credit.update"],
      inspectModeAllowed: true,
      internalGrantIds: ["capability:internal-crm"],
      credentialReferences: ["credential:vault/crm"],
    },
  });
  const supportSnapshot = renderSurface({
    instance: supportSurface,
    work,
    objects,
    expectedWorkVersion: 7,
    now: "2026-08-22T12:00:00Z",
    authority: {
      kind: "public",
      workspaceId,
      sessionId: "public-session:visitor-9",
      validFrom: "2026-08-22T11:55:00Z",
      expiresAt: "2026-08-22T12:05:00Z",
      readResources: ["customer.public.read"],
      actionResources: ["support.request.create"],
    },
  });

  assert.equal(crmSnapshot.objects[0]?.id, customerId);
  assert.equal(supportSnapshot.objects[0]?.id, customerId);
  assert.deepEqual(crmSnapshot.objects[0]?.values, {
    creditLimit: 50_000,
    name: "Harbor Labs",
  });
  assert.deepEqual(supportSnapshot.objects[0]?.values, {
    name: "Harbor Labs",
    status: "active",
  });
  assert.deepEqual(supportSnapshot, renderSurface({
    instance: supportSurface,
    work,
    objects,
    expectedWorkVersion: 7,
    now: "2026-08-22T12:00:00Z",
    authority: {
      kind: "public",
      workspaceId,
      sessionId: "public-session:visitor-9",
      validFrom: "2026-08-22T11:55:00Z",
      expiresAt: "2026-08-22T12:05:00Z",
      readResources: ["customer.public.read"],
      actionResources: ["support.request.create"],
    },
  }));
  assert.deepEqual(supportSnapshot.authorization, {
    readResources: ["customer.public.read"],
    actionResources: ["support.request.create"],
  });
  assert.equal(supportSnapshot.session.kind, "public");
  assert.equal(supportSnapshot.work.version, 7);
  assert.equal(supportSnapshot.optimisticVersion, 7);
  assert.doesNotMatch(JSON.stringify(supportSnapshot), /capabilityId|grant|credential|inspectMode/i);
});

test("public and embedded sessions fail closed outside their narrow expiring authority", () => {
  const definition = defineSurfaceDefinition({
    id: "surface:embedded-customer",
    revision: 1,
    audience: "embedded",
    view: {
      binding: "customer",
      fields: ["name"],
      readResource: "customer.public.read",
    },
    actionResources: ["support.request.create"],
  });
  const instance = bindSurfaceInstance({
    id: "surface-instance:embedded-customer",
    definition,
    application: supportApplication,
    work,
  });
  const objects = [{ id: customerId, version: 12, values: { name: "Harbor Labs" } }];
  const render = (authority: Parameters<typeof renderSurface>[0]["authority"], overrides: {
    readonly workspaceId?: string;
    readonly expectedWorkVersion?: number;
  } = {}) => renderSurface({
    instance,
    work,
    objects,
    expectedWorkVersion: overrides.expectedWorkVersion ?? 7,
    now: "2026-08-22T12:00:00Z",
    ...(authority === undefined ? {} : { authority }),
  });
  const authorized = {
    kind: "embedded" as const,
    workspaceId,
    sessionId: "embedded-session:portal-1",
    validFrom: "2026-08-22T11:55:00Z",
    expiresAt: "2026-08-22T12:05:00Z",
    readResources: ["customer.public.read"],
    actionResources: ["support.request.create"],
  };

  assert.equal(render(authorized).session.kind, "embedded");
  assert.throws(() => render(undefined), /authority context is required/);
  assert.throws(() => render({ ...authorized, workspaceId: "workspace:other" }), /workspace mismatch/);
  assert.throws(() => render({ ...authorized, kind: "public" }), /explicit embedded session/);
  assert.throws(() => render({
    ...authorized,
    actionResources: ["support.request.delete"],
  }), /undeclared surface action resource/);
  assert.throws(() => render({
    ...authorized,
    expiresAt: "2026-08-22T12:00:00Z",
  }), /expired or not yet valid/);
  assert.throws(() => render({
    ...authorized,
    capabilityId: "capability:internal",
  } as unknown as typeof authorized), /cannot contain capabilityId/);
  assert.throws(() => render(authorized, { expectedWorkVersion: 6 }), /optimistic WorkInstance version conflict/);
  assert.throws(() => bindSurfaceInstance({
    id: "surface-instance:cross-workspace",
    definition,
    application: {
      ...supportApplication,
      semanticObjectBindings: { customer: "workspace:other/semantic-object:customer-42" },
    },
    work,
  }), /outside workspace/);
  assert.throws(() => defineSurfaceDefinition({
    ...definition,
    audience: "public",
    inspectMode: true,
  } as unknown as Parameters<typeof defineSurfaceDefinition>[0]), /cannot expose inspect mode/);
});

test("external definitions reject resource identifiers that reveal internal authority", () => {
  const forbiddenResources = [
    "capability:workspace-admin",
    "credential-ref:vault/support",
    "customer.internal-grant.read",
    "surface.inspect.details",
  ];
  for (const resource of forbiddenResources) {
    assert.throws(() => defineSurfaceDefinition({
      id: "surface:unsafe-read",
      revision: 1,
      audience: "public",
      view: {
        binding: "customer",
        fields: ["name"],
        readResource: resource,
      },
      actionResources: ["support.request.create"],
    }), /external surface resource cannot reveal internal authority/);
    assert.throws(() => defineSurfaceDefinition({
      id: "surface:unsafe-action",
      revision: 1,
      audience: "embedded",
      view: {
        binding: "customer",
        fields: ["name"],
        readResource: "customer.public.read",
      },
      actionResources: [resource],
    }), /external surface resource cannot reveal internal authority/);
  }
});

test("external rendering recursively rejects private authority data in selected fields", () => {
  const definition = defineSurfaceDefinition({
    id: "surface:public-profile",
    revision: 1,
    audience: "public",
    view: {
      binding: "customer",
      fields: ["profile"],
      readResource: "customer.public.read",
    },
    actionResources: [],
  });
  const instance = bindSurfaceInstance({
    id: "surface-instance:public-profile",
    definition,
    application: supportApplication,
    work,
  });
  const authority = {
    kind: "public" as const,
    workspaceId,
    sessionId: "public-session:profile",
    validFrom: "2026-08-22T11:55:00Z",
    expiresAt: "2026-08-22T12:05:00Z",
    readResources: ["customer.public.read"],
    actionResources: [],
  };
  const unsafeProfiles = [
    { reference: "capability:workspace-admin" },
    { reference: "capability-grant:workspace-admin" },
    { nested: { reference: "credential-ref:vault/support" } },
    { nested: { reference: "credential:vault/support" } },
    { reference: "secret:workspace-signing-value" },
    { reference: "secret:..." },
    { reference: "grant:workspace-read" },
    { reference: "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature" },
    { reference: "Bearer abcdefghijklmnopqrstuvwxyz" },
    { reference: "private-key:-----BEGIN PRIVATE KEY-----" },
    { reference: "-----BEGIN RSA PRIVATE KEY-----" },
    { grant: "internal" },
    { credential: "vault/support" },
    { secret: "redacted-is-still-secret-shaped" },
    { token: "opaque" },
    { "private-key": "key-material" },
    { nested: [{ inspectMode: true }] },
  ];

  for (const profile of unsafeProfiles) {
    assert.throws(() => renderSurface({
      instance,
      work,
      objects: [{ id: customerId, version: 12, values: { profile } }],
      expectedWorkVersion: 7,
      now: "2026-08-22T12:00:00Z",
      authority,
    }), /external surface selected data contains private authority material/);
  }

  const ordinaryProse = [
    "The grant review covers capability design and credential hygiene.",
    "This is no secret: everyone can read it.",
    "Bearer responsibilities belong to the presenter.",
    "Rotate the private key according to the published policy.",
  ];
  const safeSnapshot = renderSurface({
    instance,
    work,
    objects: [{ id: customerId, version: 12, values: { profile: { notes: ordinaryProse } } }],
    expectedWorkVersion: 7,
    now: "2026-08-22T12:00:00Z",
    authority,
  });
  assert.deepEqual(safeSnapshot.objects[0]?.values, { profile: { notes: ordinaryProse } });
});

test("internal rendering can retain governed data without copying authority context fields", () => {
  const definition = defineSurfaceDefinition({
    id: "surface:internal-governed-record",
    revision: 1,
    audience: "internal",
    view: {
      binding: "customer",
      fields: ["governed"],
      readResource: "capability:customer-internal-read",
    },
    actionResources: ["customer.internal-grant.update"],
    inspectMode: true,
  });
  const instance = bindSurfaceInstance({
    id: "surface-instance:internal-governed-record",
    definition,
    application: crmApplication,
    work,
  });
  const governed = {
    credential: "credential-ref:vault/customer-42",
    token: "governed-internal-value",
    inspectMode: true,
  };
  const snapshot = renderSurface({
    instance,
    work,
    objects: [{ id: customerId, version: 12, values: { governed } }],
    expectedWorkVersion: 7,
    now: "2026-08-22T12:00:00Z",
    authority: {
      kind: "internal",
      workspaceId,
      principalId: "principal:operator",
      readResources: ["capability:customer-internal-read"],
      actionResources: ["customer.internal-grant.update"],
      inspectModeAllowed: true,
      internalGrantIds: ["capability:internal-crm"],
      credentialReferences: ["credential:vault/crm"],
    },
  });

  assert.deepEqual(snapshot.objects[0]?.values, { governed });
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /internalGrantIds|credentialReferences|inspectModeAllowed/);
  assert.doesNotMatch(serialized, /capability:internal-crm|credential:vault\/crm/);
});
