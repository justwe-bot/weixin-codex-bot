declare module "qrcode-terminal" {
  const qrcode: {
    generate(
      text: string,
      options?: { small?: boolean } | ((output: string) => void),
      callback?: (output: string) => void,
    ): void;
  };

  export default qrcode;
}
