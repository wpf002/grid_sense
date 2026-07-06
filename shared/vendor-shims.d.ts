// Ambient module shims for dependencies that ship no bundled types.
// Kept intentionally light — these libraries are used at the edges (map
// rendering, CSV export) and are effectively `any` at the call sites.

declare module "topojson-client" {
  // topojson-client's `feature` converts a TopoJSON topology + object into a
  // GeoJSON FeatureCollection. We consume it as GeoJSON, so keep it loose.
  export function feature(topology: any, object: any): any;
  export function mesh(topology: any, object?: any, filter?: any): any;
  export function merge(topology: any, objects: any): any;
}

declare module "json2csv" {
  export class Parser {
    constructor(opts?: any);
    parse(data: any): string;
  }
  export function parse(data: any, opts?: any): string;
}
