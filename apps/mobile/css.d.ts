// Permite imports de CSS (NativeWind global.css y CSS Modules del template web).
declare module '*.css';
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
