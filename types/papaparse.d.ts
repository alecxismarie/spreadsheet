declare module "papaparse" {
  export type ParseError = {
    message: string;
  };

  export type ParseResult<T> = {
    data: T[];
    errors: ParseError[];
  };

  const Papa: {
    parse<T>(
      input: string,
      config?: {
        header?: boolean;
        skipEmptyLines?: boolean | "greedy";
      }
    ): ParseResult<T>;
  };

  export default Papa;
}
