/**
 * The districts of Tamil Nadu, alphabetically.
 *
 * <p>All thirty-eight of them, so a claim's location is picked from a list
 * rather than typed. A free-text box gave "cbe", "CBE", "Coimbatore" and
 * "coimbatore " for one place, which is four rows in any report that groups by
 * location and four spellings for whoever reads it.
 *
 * <p>Kept as data rather than fetched: the list changes when the state
 * reorganises its districts, which is not something a deployment should have
 * to wait for an API to hear about.
 */
export const TN_DISTRICTS = [
  "Ariyalur",
  "Chengalpattu",
  "Chennai",
  "Coimbatore",
  "Cuddalore",
  "Dharmapuri",
  "Dindigul",
  "Erode",
  "Kallakurichi",
  "Kanchipuram",
  "Kanyakumari",
  "Karur",
  "Krishnagiri",
  "Madurai",
  "Mayiladuthurai",
  "Nagapattinam",
  "Namakkal",
  "Nilgiris",
  "Perambalur",
  "Pudukkottai",
  "Ramanathapuram",
  "Ranipet",
  "Salem",
  "Sivaganga",
  "Tenkasi",
  "Thanjavur",
  "Theni",
  "Thoothukudi",
  "Tiruchirappalli",
  "Tirunelveli",
  "Tirupathur",
  "Tiruppur",
  "Tiruvallur",
  "Tiruvannamalai",
  "Tiruvarur",
  "Vellore",
  "Viluppuram",
  "Virudhunagar",
] as const;
