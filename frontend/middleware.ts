export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/brain/:path*",
    "/performance/:path*",
    "/journal/:path*",
    "/dna/:path*",
    "/autonomous/:path*",
    "/lab/:path*",
    "/options/:path*",
    "/((?!login|api|_next/static|_next/image|favicon.ico).*)"
  ],
};
