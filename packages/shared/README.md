# @packages/shared

Shared TypeScript package for generated OpenAPI types, constants, and the
type-safe API client.

## Checks

```powershell
npm run typecheck --workspace=@packages/shared
npm run lint --workspace=@packages/shared
```

ESLint is configured locally in `.eslintrc.cjs`. `generated/types.ts` is ignored
because it is produced by `openapi-typescript`; `generated/client.ts` is checked
because it contains the maintained client wrapper.

## API Client Errors

`createApiClient()` throws `ApiClientError` for API errors. The error keeps the
structured server response where available:

```ts
try {
  await api.search({ name: 'Kunde' });
} catch (error) {
  if (error instanceof ApiClientError) {
    console.error(error.code, error.details, error.status);
  }
}
```

Use `code`, `message`, `details`, and `status` for UI decisions instead of
parsing raw error strings.
