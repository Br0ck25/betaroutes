# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

---

## HughesNet Archived Orders API 🔧

A new endpoint is available to inspect archived (previously synced) orders persisted from HughesNet:

- GET /api/hughesnet/archived - returns a list of archived orders for the authenticated user
- GET /api/hughesnet/archived?id=<ORDER_ID> - returns a single archived order if it belongs to the authenticated user

This endpoint reads from `BETA_HUGHESNET_ORDERS_KV` and only returns records scoped to the requesting user.
