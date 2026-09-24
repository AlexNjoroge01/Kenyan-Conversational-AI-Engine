// Test code reads JSON bodies loosely; make Response#json() return `any` instead of `unknown`.
interface Response {
  json(): Promise<any>;
}
