import { data } from "react-router";

import ErrorPage from "~/layout/error-page";

// Matching a document route lets the root loader read language and theme cookies.
export function loader() {
  return data(null, { status: 404 });
}

export const action = loader;

export default function NotFound() {
  return (
    <ErrorPage error={{ status: 404, statusText: "Not Found", internal: false, data: null }} />
  );
}
