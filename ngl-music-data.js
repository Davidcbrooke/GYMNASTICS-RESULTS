/* NGL floor music: entries pulled from Elevien on 9 Oct 2026.
   Format per gymnast: [Elevien contestantId, name, club key]
   Lists are in Elevien's vault order; floor order is set in the admin page.
   bg = the club number Elevien shows in brackets. A Club Hub account whose BG club number
   matches exactly sees its gymnasts automatically; others can be linked in the admin page. */
window.NGL_MUSIC_DATA = {
  compKey: "finals2026",
  title: "NGL National Finals 2026",
  date: "2026-11-22",
  deadline: "Friday 13 November 2026",   // CHECK: change to your real deadline
  clubs: {
    react:    {name:"React Trampoline & Gymnastics Club", bg:"CL094353"},
    prostar:  {name:"Pro-Star Gymnastics Academy", bg:"91164"},
    flipping: {name:"Flipping Out Gymnastics", bg:"92838"},
    saadi:    {name:"SAADI Gymnastics", bg:"40556"},
    kgym:     {name:"K-Gymnastics", bg:"91166"},
    lisburn:  {name:"City of Lisburn Salto National Gym Centre", bg:"40178"},
    elite:    {name:"Elite Gymnastics Academy", bg:"91978"},
    nbirm:    {name:"North Birmingham Community Gymnastics", bg:"40377"},
    lifestyle:{name:"Lifestyle Gymnastics Academy", bg:"89896"},
    rathgael: {name:"Rathgael Gymnastics & Tumbling Club", bg:"40334"}
  },
  levels: [
    { id:"A", name:"Level A", session:"Morning (Level A competition)", gymnasts:[
      ["158935","Isabella Pakas","react"],["158932","Penelope Pollock-Victoria","react"],["158936","Amy Fuller","react"],
      ["158933","Mikayla Forsyth","react"],["158934","Abbey Roszkowska","react"],
      ["158947","Ava O'Hara","prostar"],["158944","Molly Kane","prostar"],["158945","Cali Adams","prostar"],["158946","Ella-Jane Jackson","prostar"],
      ["158962","Sydney-Rai Morahan-Cooke","flipping"],["158966","Isla Churchill","flipping"],["158959","Imani Williams","flipping"],
      ["158963","Laylaa Hobbis","flipping"],["158960","Holly Rae Hunt","flipping"],["158964","Maya-Ann Byng","flipping"],
      ["158961","Alexandra Hodson","flipping"],["158965","Ester Marreiros","flipping"],
      ["158937","Zoe Schoombee","saadi"],["158943","Laura Mills","saadi"],["158925","Elissia Mai Lowe","kgym"],["158929","Gracie Lowe","kgym"],
      ["158941","Edith Davis","saadi"],["158926","Poppy Osborn","kgym"],["158930","Ava Cruwys","kgym"],["158938","Lara Mell","saadi"],
      ["158942","Violet Landry","saadi"],["158927","Eliza Tanasa","kgym"],["158931","Maylie Singh","kgym"],["158939","Tilly Evans","saadi"],
      ["158928","Taylor-Rose Lerigo","kgym"],["158940","Sophie Hutton","saadi"],
      ["158958","Tahlia Taggart","lisburn"],["158948","Willow Currie","elite"],["158952","Katie De Niro","elite"],["158956","Milana Flederiene","lisburn"],
      ["158953","Rebekah Rice","elite"],["158949","Emily Rose Mcguckin","elite"],["158957","Sophie Harper","lisburn"],["158954","Maisie Hamill","elite"],
      ["158950","Anabel Mcmurray","elite"],["158951","Dayah Doherty","elite"],["158955","Ellie Foreman","lisburn"]
    ]},
    { id:"B", name:"Level B", session:"Afternoon (Levels B and C competition)", gymnasts:[
      ["159642","Kaitlyn Kavanagh","lisburn"],["158987","Mathilda Clinch","saadi"],["158968","Arabella Hewitt","kgym"],["158980","Alma Peters","saadi"],
      ["158984","Alyssa Clark","saadi"],["158988","Helena Lacey","saadi"],["158969","Maisie Fowler","kgym"],["158981","Emily Todd","saadi"],
      ["158985","Olivia Miller","saadi"],["158989","Charlotte Welsh","saadi"],["158982","Sophia Baker","saadi"],["158986","Joelle Lee","saadi"],
      ["158967","Macey Ready","kgym"],["158979","Lucy Le Grice","saadi"],["158983","Lexi Chases","saadi"],["158978","Niya Mistry","saadi"],
      ["158975","Daisy Smith","react"],["158970","Eliza Crane","react"],["158971","Isla Hall","react"],["159030","Alice Stokell","react"],
      ["158972","Isabella Roberson","react"],["158973","Lexi Roberson","react"],
      ["159625","Orlaith Johal","nbirm"],["159629","Anushka Nath","nbirm"],["159002","Alara Jennings","flipping"],["159006","Daria Rusu","flipping"],
      ["159622","Tilly Cannan","nbirm"],["159626","Bridget Gannon","nbirm"],["159623","Sophie Jamieson","nbirm"],["159003","Melody France","flipping"],
      ["159627","Doroteja Acaite","nbirm"],["159004","Iris Clennell","flipping"],["159624","Tishay Harding-Rowe","nbirm"],["159628","Faye Miles","nbirm"],
      ["159001","Isobel Darkes","flipping"],["159005","Ava Nash","flipping"],
      ["158998","Erika Lyttle","lisburn"],["158991","Isla Wray","prostar"],["158995","Cassie Evans","elite"],["158999","Bailee Flack","lisburn"],
      ["158976","Megan Richards","rathgael"],["158996","Isabel Mcerlean","elite"],["158977","Ava Mccaughey","rathgael"],["158993","Daisy Adair","prostar"],
      ["158997","Anna-rose Caskey","elite"],["158992","Annabel Boal","prostar"],["158990","Isla Vance","prostar"],["158994","Jenna Mcerlain","elite"]
    ]},
    { id:"C", name:"Level C", session:"Afternoon (Levels B and C competition)", gymnasts:[
      ["159022","Lucy Connaughty","lifestyle"],["159026","Autumn-Secret Mcmillan","prostar"],["159025","Sophie Shields","prostar"],
      ["159029","Mya-Isabella Close","lisburn"],["159021","Maia Mcgurk","lifestyle"],["159028","Rachel Kernohan","lisburn"],
      ["159024","Haleigh Miskimmin","prostar"],["159020","Mae Mcgarry","lifestyle"],["159027","Dearbhla Boyle","lisburn"],
      ["159023","Ruby Averill","lifestyle"],["159019","Leeanne Mcauley","lifestyle"],
      ["159011","Ellie Johns","react"],["159007","Isabel Grace Hughes","react"],["159009","Chloe Storrer","react"],["159012","Poppy Sampson","react"],
      ["159008","Emma Clayton","react"],["159010","Erin Watts","react"],
      ["159013","Isobel Davies","saadi"],["159017","Maddie Akpan","saadi"],["159016","Josie Norton","saadi"],
      ["159631","Betsey Hemus","nbirm"],["159635","Zuri Youngsam","nbirm"],["159632","Isla Innis","nbirm"],["159636","Lacey Lea-Goodman","nbirm"],
      ["159630","Carmen Gannon","nbirm"],["159633","Charlotte Holt","nbirm"],["159637","Freya Hemming","nbirm"],["159634","Beatriz James","nbirm"],
      ["159638","Molly Rawlings","nbirm"],
      ["159018","Isabelle Amet","saadi"],["159014","Lexie Braybrooke","saadi"],["159015","Sophia Jakeman","saadi"]
    ]}
  ]
};
