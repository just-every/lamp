import { Fragment } from 'react';
import { Plate } from './Plate';
import { TERMINAL } from './sample';
import './export-plate.css';

const LABEL = 'Drawing of a terminal: pnpm run setup provisions Lamp, pnpm run deploy passes its smoke check, and pnpm run export writes every database record and stored file to a backup folder holding entities.json, manifest.json and objects.';

// Each word of a terminal line is kept whole, so a narrow terminal wraps between words, never inside `--environment`.
function Words({ line }: { line: string }) {
  return <>{line.split(' ').map((word, index) => <Fragment key={index}>{index ? ' ' : ''}<span className="lamp-export__word">{word}</span></Fragment>)}</>;
}

// Plate H: in, live and out, in the owner's own terminal, the page's one dark card: each command, then what it prints.
export function ExportPlate() {
  return <Plate label={LABEL} className="lamp-export">
    <div className="lamp-plate__mono lamp-export__lines">
      {TERMINAL.map(({ command, output }) => <div className="lamp-export__step" key={command}>
        <p className="lamp-export__command"><span className="lamp-export__prompt">$ </span><Words line={command} /></p>
        {output.map((line) => <p className="lamp-export__output" key={line}><Words line={line} /></p>)}
      </div>)}
    </div>
  </Plate>;
}
