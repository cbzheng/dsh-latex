// Project skeletons. Every template uses the same layout: a short main.tex that only
// wires things together, Meta/ for the preamble and front matter, Sections/ with one
// numbered file per section, Figures/ and Tables/ for floats, references.bib.
// Class and bibliography style files come from the publisher (src/templates.mjs).

const GITIGNORE='*.aux\n*.log\n*.out\n*.synctex.gz\n*.blg\n*.fls\n*.fdb_latexmk\n*.toc\n';
const BIB=`@book{lamport1994latex,
  author    = {Leslie Lamport},
  title     = {{LaTeX}: A Document Preparation System},
  edition   = {2},
  publisher = {Addison-Wesley},
  address   = {Reading, MA},
  year      = {1994}
}
`;
// Shared writing macros. classPackages lists what the class does not load itself.
const commands=classPackages=>`%% Packages
${classPackages}\\usepackage{xspace}
\\usepackage{tabularx}
\\usepackage{makecell}
\\usepackage{enumitem}
\\graphicspath{{Figures/}}

%% Names used throughout the paper: define once, change once
\\newcommand{\\sysname}{SystemName\\xspace}

%% Draft notes. Empty the definitions before submission.
\\newcommand{\\todo}[1]{\\textcolor{red}{[TODO] \\emph{#1}}}
\\newcommand{\\draft}[1]{\\textcolor{blue}{#1}}
\\newcommand{\\side}[1]{\\marginpar{\\raggedright\\tiny\\color{blue}#1}}
%% Revised text: switch black to a colour while preparing a revision.
\\newcommand{\\rev}[1]{\\textcolor{black}{#1}}

%% Bold inline paragraph heading
\\newcommand{\\parHeading}[1]{\\vspace{8px}\\noindent{\\textbf{#1}}}

%% Participant quotes
\\newcommand{\\iq}[1]{\`\`\\textit{#1}''}
\\newcommand{\\myquote}[1]{\\emph{\`\`#1''}}
\\newcommand{\\myquoteparticipant}[2]{\\emph{\`\`#1''}~(#2)}
\\newcommand{\\mylongquote}[1]{\\begin{quote}\\emph{#1}\\end{quote}}

%% Short names for \\autoref
\\AtBeginDocument{%
  \\renewcommand{\\sectionautorefname}{Sec.\\negthinspace}%
  \\renewcommand{\\subsectionautorefname}{Sec.\\negthinspace}%
  \\renewcommand{\\subsubsectionautorefname}{Sec.\\negthinspace}%
  \\renewcommand{\\figureautorefname}{Fig.\\negthinspace}%
}

%% Tracked changes: \\added{}, \\deleted{}, \\replaced{new}{old}, \\comment{}
%% (\\chcomment{} where the class already defines \\comment, as acmart does).
%% Add the option final to print the clean text: \\usepackage[final]{changes}
\\usepackage[commentmarkup=margin,commandnameprefix=ifneeded]{changes}
\\definechangesauthor[name={AI}, color=blue]{AI}
\\setdeletedmarkup{\\textcolor{red!75!black}{\\sout{#1}}}
`;
const section=(title,label,body='')=>`\\section{${title}}\n\\label{sec:${label}}\n\n${body}`;

const article=()=>({main:'main.tex',engine:'pdflatex',files:[
 {path:'main.tex',text:'\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\title{A new paper}\n\\author{}\n\\date{}\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\nStart writing here.\n\n\\end{document}\n'},
 {path:'.gitignore',text:'*.aux\n*.log\n*.out\n*.synctex.gz\n'}
]});

const acm=({title,year})=>({main:'main.tex',engine:'pdflatex',files:[
 {path:'main.tex',text:`%% Class options
%%   manuscript,review,anonymous   single-column submission for review (CHI, CSCW, UIST)
%%   sigconf                       conference proceedings, camera ready
%%   acmsmall                      PACM HCI (CSCW) and ACM journals, camera ready
\\documentclass[manuscript,review,anonymous]{acmart}

%% Rights and venue: replace with the values from the ACM rights form.
\\setcopyright{acmlicensed}
\\copyrightyear{${year}}
\\acmYear{${year}}
\\acmDOI{XXXXXXX.XXXXXXX}
\\acmConference[Conference acronym 'XX]{Conference title}{Month DD--DD, ${year}}{City, Country}
\\acmISBN{978-1-4503-XXXX-X/${year}/06}

\\input{Meta/commands}

\\begin{document}

\\title{${title}}
\\input{Meta/authors}
\\renewcommand{\\shortauthors}{First Author et al.}

\\input{Sections/abstract}
\\input{Meta/ccsxml}

\\maketitle

\\input{Sections/01-introduction}
\\input{Sections/02-related-work}
\\input{Sections/03-method}
\\input{Sections/04-findings}
\\input{Sections/05-discussion}
\\input{Sections/06-conclusion}
\\input{Sections/ack}

\\bibliographystyle{ACM-Reference-Format}
\\bibliography{references}

\\input{Sections/appendix}

\\end{document}
`},
 {path:'Meta/commands.tex',text:commands('')},
 {path:'Meta/authors.tex',text:`\\author{First Author}
\\orcid{0000-0000-0000-0000}
\\affiliation{%
  \\institution{Institution}
  \\city{City}
  \\country{Country}}
\\email{first.author@example.org}

\\author{Second Author}
\\affiliation{%
  \\institution{Institution}
  \\city{City}
  \\country{Country}}
\\email{second.author@example.org}
`},
 {path:'Meta/ccsxml.tex',text:`%% Generate the concepts at https://dl.acm.org/ccs and paste them here.
\\begin{CCSXML}
<ccs2012>
   <concept>
       <concept_id>10003120.10003121.10011748</concept_id>
       <concept_desc>Human-centered computing~Empirical studies in HCI</concept_desc>
       <concept_significance>500</concept_significance>
       </concept>
 </ccs2012>
\\end{CCSXML}

\\ccsdesc[500]{Human-centered computing~Empirical studies in HCI}

\\keywords{keyword one, keyword two, keyword three}
`},
 {path:'Sections/abstract.tex',text:'\\begin{abstract}\nSummarise the problem, the approach, the main findings and why they matter.\n\\end{abstract}\n'},
 {path:'Sections/01-introduction.tex',text:section('Introduction','introduction','Start writing here. Cite with \\texttt{\\textbackslash cite}~\\cite{lamport1994latex} and refer to sections with \\autoref{sec:method}.\n')},
 {path:'Sections/02-related-work.tex',text:section('Related Work','related-work')},
 {path:'Sections/03-method.tex',text:section('Method','method')},
 {path:'Sections/04-findings.tex',text:section('Findings','findings')},
 {path:'Sections/05-discussion.tex',text:section('Discussion','discussion')},
 {path:'Sections/06-conclusion.tex',text:section('Conclusion','conclusion')},
 {path:'Sections/ack.tex',text:'%% Hidden automatically while the anonymous option is set.\n\\begin{acks}\nThank the people and funders who supported this work.\n\\end{acks}\n'},
 {path:'Sections/appendix.tex',text:'\\appendix\n\n\\section{Additional Material}\n\\label{app:additional}\n\n'},
 {path:'Figures/.gitkeep',text:''},{path:'Tables/.gitkeep',text:''},
 {path:'references.bib',text:BIB},{path:'.gitignore',text:GITIGNORE}
]});

const nature=({title})=>({main:'main.tex',engine:'pdflatex',files:[
 {path:'main.tex',text:`%% Springer Nature journal article (sn-jnl).
%% Reference styles: sn-nature (Nature Portfolio), sn-basic, sn-mathphys-num, sn-mathphys-ay,
%% sn-aps, sn-vancouver-num, sn-vancouver-ay, sn-apa, sn-chicago. For another style, change the
%% option and move its .bst from bst/ next to this file. Add lineno or referee for review copies.
\\documentclass[pdflatex,sn-nature]{sn-jnl}

\\input{Meta/commands}

\\begin{document}

\\title[Short Title]{${title}}
\\input{Meta/authors}

\\input{Sections/abstract}
\\keywords{keyword one, keyword two, keyword three}

\\maketitle

\\input{Sections/01-introduction}
\\input{Sections/02-results}
\\input{Sections/03-discussion}
\\input{Sections/04-methods}

\\backmatter
\\input{Sections/declarations}
\\input{Sections/appendix}

\\bibliography{references}

\\end{document}
`},
 {path:'Meta/commands.tex',text:commands('\\usepackage{graphicx}\n\\usepackage{amsmath,amssymb,amsfonts}\n\\usepackage{xcolor}\n\\usepackage{booktabs}\n\\usepackage{multirow}\n\\usepackage[title]{appendix}\n')},
 {path:'Meta/authors.tex',text:`%% The star marks the corresponding author; numbers link authors to affiliations.
\\author*[1]{\\fnm{First} \\sur{Author}}\\email{first.author@example.org}
\\author[2]{\\fnm{Second} \\sur{Author}}

\\affil*[1]{\\orgdiv{Department}, \\orgname{Organization}, \\orgaddress{\\city{City}, \\country{Country}}}
\\affil[2]{\\orgdiv{Department}, \\orgname{Organization}, \\orgaddress{\\city{City}, \\country{Country}}}
`},
 {path:'Sections/abstract.tex',text:'\\abstract{Summarise the background, the main result and its significance in one paragraph without citations.}\n'},
 {path:'Sections/01-introduction.tex',text:section('Introduction','introduction','Start writing here. Cite with \\texttt{\\textbackslash cite}~\\cite{lamport1994latex} and refer to sections with \\autoref{sec:methods}.\n')},
 {path:'Sections/02-results.tex',text:section('Results','results')},
 {path:'Sections/03-discussion.tex',text:section('Discussion','discussion')},
 {path:'Sections/04-methods.tex',text:section('Methods','methods')},
 {path:'Sections/declarations.tex',text:`\\bmhead{Supplementary information}
Describe any supplementary files.

\\bmhead{Acknowledgements}
Thank the people and funders who supported this work.

\\section*{Declarations}

\\bmhead{Data availability}
State where the data can be obtained.

\\bmhead{Code availability}
State where the code can be obtained.

\\bmhead{Author contributions}
Describe each author's contribution.

\\bmhead{Competing interests}
The authors declare no competing interests.
`},
 {path:'Sections/appendix.tex',text:'\\begin{appendices}\n\n\\section{Extended Data}\n\\label{app:extended-data}\n\nAdd extended data figures and tables here.\n\n\\end{appendices}\n'},
 {path:'Figures/.gitkeep',text:''},{path:'Tables/.gitkeep',text:''},
 {path:'references.bib',text:BIB},{path:'.gitignore',text:GITIGNORE}
]});

export const SKELETONS={article,acm,nature};
