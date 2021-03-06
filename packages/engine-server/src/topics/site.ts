import {
  DendronError,
  DendronSiteConfig,
  DVault,
  HierarchyConfig,
  NotePropsDictV2,
  NotePropsV2,
  NoteUtilsV2,
} from "@dendronhq/common-all";
import _ from "lodash";
import { DConfig } from "../config";
import { DEngineClientV2 } from "../types";
import { stripLocalOnlyTags } from "../utils";
import fs from "fs-extra";
import path from "path";
import { vault2Path } from "@dendronhq/common-server";

export class SiteUtils {
  static canPublish(opts: { note: NotePropsV2; config: HierarchyConfig }) {
    const { note, config } = opts;
    return _.some([
      // not blacklisted
      note.custom?.published !== false,
      // not whitelisted
      !config.publishByDefault && !note.custom?.published,
      // TODO: check vault
    ]);
  }

  static async copyAssets(opts: {
    wsRoot: string;
    vault: DVault;
    siteAssetsDir: string;
  }) {
    const { wsRoot, vault, siteAssetsDir } = opts;
    const vaultAssetsDir = path.join(vault2Path({ wsRoot, vault }), "assets");
    return fs.copy(path.join(vaultAssetsDir), path.join(siteAssetsDir));
  }

  static async filterByConfig(opts: {
    engine: DEngineClientV2;
    config: DendronSiteConfig;
  }): Promise<NotePropsDictV2> {
    const { engine, config } = opts;
    const { siteHierarchies } = config;
    const hiearchiesToPublish = await Promise.all(
      siteHierarchies.map(async (domain, idx) => {
        const hiearchy = SiteUtils.filterByHiearchy({
          domain,
          config: DConfig.cleanSiteConfig(config),
          engine,
          navOrder: idx,
        });
        return hiearchy;
      })
    );
    return _.reduce(
      hiearchiesToPublish,
      (ent, acc) => {
        return _.merge(acc, ent);
      },
      {}
    );
  }

  static filterByHiearchy(opts: {
    domain: string;
    config: DendronSiteConfig;
    engine: DEngineClientV2;
    navOrder: number;
  }) {
    const { domain: fname, engine, navOrder, config } = opts;

    // get config
    let rConfig: HierarchyConfig = _.defaults(
      _.get(config, "root", {
        publishByDefault: true,
        noindexByDefault: false,
        customFrontmatter: [],
      })
    );
    let hConfig: HierarchyConfig = _.defaults(_.get(config, fname), rConfig);

    // get the domain note
    let notes = NoteUtilsV2.getNotesByFname({
      fname,
      notes: engine.notes,
    }).filter((note) => SiteUtils.canPublish({ note, config: hConfig }));

    let domainNote: NotePropsV2;
    if (notes.length > 1) {
      throw new DendronError({ msg: `mult notes found for ${fname}` });
    } else if (notes.length < 1) {
      throw new DendronError({ msg: `no notes found for ${fname}` });
    } else {
      domainNote = { ...notes[0] };
    }
    if (!domainNote.custom) {
      domainNote.custom = {};
    }
    domainNote.custom.nav_order = navOrder;
    domainNote.parent = null;
    domainNote.title = _.capitalize(domainNote.title);
    if (domainNote.fname === config.siteIndex) {
      domainNote.custom.permalink = "/";
    }

    const out: NotePropsDictV2 = {};
    const processQ = [domainNote];
    while (!_.isEmpty(processQ)) {
      const note = processQ.pop() as NotePropsV2;
      // if (note.parent && engine.notes[note.parent].fname === config.siteIndex) {
      //note.parent = null;
      // }
      const maybeNote = SiteUtils.filterByNote({ note, hConfig });
      if (maybeNote) {
        let children = maybeNote.children.map((id) => engine.notes[id]);
        children = _.filter(children, (note: NotePropsV2) =>
          SiteUtils.canPublish({ note, config: hConfig })
        );
        children.forEach((n: NotePropsV2) => processQ.push(n));
        // updated children
        out[maybeNote.id] = {
          ...maybeNote,
          children: children.map((ent) => ent.id),
        };
      }
    }
    return out;
  }

  static filterByNote(opts: {
    note: NotePropsV2;
    hConfig: HierarchyConfig;
  }): NotePropsV2 | undefined {
    const { note, hConfig } = opts;

    // apply custom frontmatter if exist
    hConfig.customFrontmatter?.forEach((fm) => {
      const { key, value } = fm;
      // @ts-ignore
      meta[key] = value;
    });

    // remove site-only stuff
    return {
      ...note,
      body: stripLocalOnlyTags(note.body),
    };
  }
}
